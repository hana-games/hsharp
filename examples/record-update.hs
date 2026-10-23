record Point {
    x: i32,
    y: i32,
}

fn main() -> bool {
    let original: Point = Point { x: 1, y: 2 };
    let moved: Point = Point { ...original, x: 3 };
    let copy: Point = Point { ...original };
    return original.x == 1 && moved.x == 3 && moved.y == 2 && copy == original && moved != original;
}
