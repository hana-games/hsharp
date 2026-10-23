record Point {
    x: i32,
    y: i32,
}

record Line {
    a: Point,
    b: Point,
}

fn main(p: Point, line: Line, flag: bool) -> bool {
    return p.x == 1 && p.y == 2
        && line.a.x == 3 && line.a.y == 4
        && line.b.x == 5 && line.b.y == 6
        && flag;
}
