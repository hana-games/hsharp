// Immutable variant slice: nominal constructors, internal parameters and
// returns, exhaustive matching, structural equality, and scalar entry outcome.
variant Shape {
    circle(i32),
    rectangle(i32, i32),
    empty,
}

fn area(shape: Shape) -> i32 {
    return match shape {
        circle(r) => r * r,
        rectangle(w, h) => w * h,
        empty() => 0,
    };
}

fn make(kind: i32) -> Shape {
    if kind == 0 {
        return circle(3);
    }
    if kind == 1 {
        return rectangle(2, 4);
    }
    return empty();
}

fn main() -> bool {
    let a: Shape = circle(3);
    let b: Shape = make(1);
    let c: Shape = rectangle(2, 4);
    let d: Shape = empty();
    let same: Shape = a;
    return a == same
        && a != b
        && b == c
        && d != a
        && area(a) == 9
        && area(b) == 8
        && area(c) == 8
        && area(d) == 0
        && area(make(0)) == 9;
}
