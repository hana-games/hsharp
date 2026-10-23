// Built-in Option and Result slice: constructors, exhaustive match, structural
// equality, internal parameters, internal returns, and a scalar entry outcome.
fn safeAdd(a: i32, b: i32) -> Option<i32> {
    if a > 100 || b > 100 {
        return none();
    }
    return some(a + b);
}

fn valueOr(value: Option<i32>, fallback: i32) -> i32 {
    return match value {
        some(x) => x,
        none() => fallback,
    };
}

fn validate(flag: bool) -> Result<bool> {
    if flag {
        return ok(true);
    }
    return err("flag is false");
}

fn accepted(result: Result<bool>) -> bool {
    return match result {
        ok(value) => value,
        err(message) => message == "flag is false",
    };
}

fn main() -> bool {
    let present: Option<i32> = some(3);
    let computed: Option<i32> = safeAdd(1, 2);
    let absent: Option<i32> = none();
    let tooLarge: Option<i32> = safeAdd(200, 1);
    let reused: Option<i32> = present;

    let good: Result<i32> = ok(7);
    let bad: Result<i32> = err("nope");
    let badCopy: Result<i32> = bad;
    let valid: Result<bool> = validate(true);
    let invalid: Result<bool> = validate(false);

    return present == computed
        && present == reused
        && present != absent
        && absent == none()
        && tooLarge == none()
        && valueOr(present, 9) == 3
        && valueOr(absent, 9) == 9
        && valueOr(tooLarge, 5) == 5
        && good == ok(7)
        && good != bad
        && bad == badCopy
        && bad != err("other")
        && accepted(valid)
        && accepted(invalid)
        && match good {
            ok(value) => value == 7,
            err(message) => message == "unreachable",
        };
}
