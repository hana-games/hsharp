// Immutable list slice: literals, indexing, length, internal parameters,
// internal returns, and structural equality.
fn pick(xs: list<i32>, i: i32) -> i32 {
    return xs[i];
}

fn flags() -> list<bool> {
    return [true, false, true];
}

fn main() -> bool {
    let xs: list<i32> = [10, 20, 30];
    let copy: list<i32> = xs;
    let bs: list<bool> = flags();
    return length(xs) == 3
        && xs[0] == 10
        && xs[2] == 30
        && pick(xs, 1) == 20
        && xs == copy
        && bs[0]
        && !bs[1]
        && length(bs) == 3;
}
