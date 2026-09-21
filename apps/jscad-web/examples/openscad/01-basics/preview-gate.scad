// $preview is true while the model is displayed (OpenSCAD's F5) and false when
// it is exported (F6). NopSCADlib's test files gate all their geometry on it.

if ($preview)
    cube(10, center = true);
else
    cube(30, center = true);
