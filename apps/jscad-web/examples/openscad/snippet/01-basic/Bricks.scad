module Bricks(){
    colors = ["#cb6b6b","#dd7d7d","#9e3333","#842020"];

    single_rand = rands(5,10,1)[0];
    single_rand2 = rands(5,10,1)[0];

    index_color = rands(0,3,1)[0]; // get a single number

    color(colors[index_color])
    linear_extrude(height = 3){
    square([single_rand,single_rand2]);
    }
}

Bricks();

translate([10,0,0])
Bricks();

// Written by Nicolì Angelo (Gengio) 2024: 
// MIT License


//Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

//The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.