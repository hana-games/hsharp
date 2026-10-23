record Point {
    x: i32,
    y: i32,
}

fn add(a: Point, b: Point) -> i32 {
    return a.x + b.x + a.y + b.y;
}

fn main() -> bool {
    let first: Point = Point { x: 1, y: 2 };
    let second: Point = Point { y: 4, x: 3 };
    let mirrored: Point = Point { y: 2, x: 1 };
    return first == mirrored && first != second && add(first, second) == 10;
}
