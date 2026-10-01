M2_block = [2, 4];
M3_block = [3, 6];
blocks = [M2_block, M3_block];

module block(type, tall = false) {
  cube([type[1], type[1], tall ? 2 * type[0] : type[0]]);
}

module strict(type) {
  assert(is_list(type), "type must be a size");
  block(type);
}

module rod(type, length) {
  assert(is_num(length), "length must be a number");
  cube([type[1], type[1], length]);
}
