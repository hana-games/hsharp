fn first(x: i32) -> i32 {
    return second(x);
}

fn second(x: i32) -> i32 {
    return first(x);
}
