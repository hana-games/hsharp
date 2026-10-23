record Point {
    x: i32,
    y: i32,
}

fn make(x: i32) -> Point {
    return Point { x: x, y: x + 1 };
}

fn main() -> bool {
    let p: Point = make(1);
    return p.x == 1 && p.y == 2;
}
