record Point {
    x: i32,
    y: i32,
}

record Segment {
    a: Point,
    b: Point,
}

fn main() -> bool {
    let p: Point = Point { x: 1, y: 2 };
    let q: Point = Point { x: 3, y: 4 };
    let s: Segment = Segment { a: p, b: q };
    let mirrored: Point = Point { y: 2, x: 1 };
    return p == mirrored && s.a == p && s.b.y == 4 && s.a.x + s.b.y == 5;
}
