# Moondream 3.1 describer for the agent-loop eval, started by eval/describe.js in the venv from
# scripts/describer-setup.sh; its JSON-lines protocol is in docs/architecture.md (The describer).

import errno
import ipaddress
import json
import os
import socket
import sys
import time

KESTREL = "0.9.1"
MODEL = "moondream3.1-9B-A2B"
SETTINGS = {"temperature": 0.0, "max_tokens": 300}
RUNTIME = {"enable_prefix_cache": False, "kv_cache_pages": 4096, "max_batch_size": 1, "decode_path": "native"}


def is_loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


def install_connection_guard():
    """Refuses every IP connection to a host other than loopback; returns the refused addresses."""
    blocked = []
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex

    def refused(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6) and not is_loopback(str(address[0])):
            blocked.append(str(address))
            return True
        return False

    def connect(self, address):
        if refused(self, address):
            raise ConnectionRefusedError(f"outbound connection refused: {address}")
        return real_connect(self, address)

    def connect_ex(self, address):
        if refused(self, address):
            return errno.ECONNREFUSED
        return real_connect_ex(self, address)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    return blocked


def silence_telemetry():
    """kestrel 0.9.1 posts usage to api.moondream.ai at start, every 60 s and at shutdown, with no setting to stop it."""
    import kestrel.model_download as kmd
    import kestrel.photon as kp

    async def no_flush(self, *, rotate=True):
        return None

    kp.PhotonReporter._flush_window = no_flush
    kp.PhotonReporter.start = lambda self: None
    kmd.probe_supported_model_configs = lambda *a, **k: None


def fit_12gb_card():
    """Stock kestrel 0.9.1 does not fit Moondream 3.1 on a 12 GB card."""
    import kestrel.models.moondream.weights as kmw
    import torch
    import torch.nn as nn
    from kestrel.models.moondream._moe_layout import _interleave_gate_up_rows8
    from kestrel.models.moondream.model import MoondreamModel

    original_to_empty = nn.Module.to_empty

    # The bf16 placeholders for the MoE experts alone overflow the card; the fp8 weights replace them at load.
    def lean_to_empty(self, *, device, recurse=True):
        for block in self.text.blocks:
            if hasattr(block.mlp, "router"):
                fused = block.mlp["mlp"]
                for name in ("up_experts", "down_experts"):
                    getattr(fused, name).weight = nn.Parameter(torch.empty(0, dtype=torch.uint8, device="meta"), requires_grad=False)
        return original_to_empty(self, device=device, recurse=recurse)

    # The padded up-projection slab only feeds the megakernel; decode_path="native" reads per-layer weights.
    def per_layer_up(fused, up_w_slab, up_scale_slab, layer_idx, up_weight_uint8, up_scale, inter):
        fused.up_experts.weight = nn.Parameter(_interleave_gate_up_rows8(up_weight_uint8, inter), requires_grad=False)
        fused.up_experts.register_buffer("scale", _interleave_gate_up_rows8(up_scale, inter).float())

    MoondreamModel.to_empty = lean_to_empty
    kmw.build_md3_moe_up_slab = lambda text, **kw: (None, None)
    kmw.set_md3_moe_up_layer = per_layer_up


def main():
    os.environ["HF_HUB_OFFLINE"] = "1"
    # Library output would corrupt the protocol: fd 1 becomes stderr, replies go to a copy of the original.
    protocol = os.fdopen(os.dup(1), "w", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    def send(message):
        protocol.write(json.dumps(message, ensure_ascii=False) + "\n")
        protocol.flush()

    blocked = install_connection_guard()
    try:
        from importlib.metadata import PackageNotFoundError, version

        try:
            installed = version("kestrel")
        except PackageNotFoundError:
            installed = None
        if installed != KESTREL:
            send({"fatal": f"describe.py patches kestrel {KESTREL} and found {installed or 'none'}; run scripts/describer-setup.sh", "blockedConnections": len(blocked)})
            return 2
        silence_telemetry()
        import moondream as md

        fit_12gb_card()
        started = time.time()
        client = md.photon(MODEL, **RUNTIME)
    except Exception as error:  # noqa: BLE001 - the parent reports it
        send({"fatal": f"the describer did not start: {error!r}"[:1000], "blockedConnections": len(blocked)})
        return 2
    model = client._model
    send({"ready": True, "model": MODEL, "kestrel": KESTREL, "loadMs": round((time.time() - started) * 1000)})

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            rid, image_path, prompt = request["id"], request["image"], request["prompt"]
        except (ValueError, KeyError, TypeError):
            send({"id": None, "error": "malformed request"})
            continue
        started = time.time()
        try:
            with open(image_path, "rb") as f:
                image = f.read()
            result = client._run(model.query(image=image, question=prompt, reasoning=False, stream=False, settings=SETTINGS))
            metrics = result.metrics
            send({
                "id": rid,
                "text": (result.output.get("answer") or "").strip(),
                "ms": round((time.time() - started) * 1000),
                "inputTokens": getattr(metrics, "input_tokens", None),
                "outputTokens": getattr(metrics, "output_tokens", None),
            })
        except Exception as error:  # noqa: BLE001 - one image failed, the rest go on
            send({"id": rid, "error": repr(error)[:500]})

    client.close()
    send({"done": True, "blockedConnections": len(blocked)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
