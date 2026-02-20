module Wall_01(col = 0, rot = 0){

    rotate([0,0,90 * rot]){
    
    translate([-0.06,0,0])
    color("white")
    cube([0.02,1,2], center= true);
    
    color("#295f48")
    translate([0.06,0,0])
    color("white")
    cube([0.02,1,2], center= true);
    
    
    color("#b2b2b2"){
    cube([0.1,1,1.98], center= true);
    
    translate([0.095,0,-0.9])    
    color("gray")
    cube([0.05,1,0.2], center= true);
    }
    }
}

Wall_01();

// Written by Nicolì Angelo (Gengio) 2024: 
// MIT License

//Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

//The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
