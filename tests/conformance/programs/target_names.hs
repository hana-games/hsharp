// These names are reserved in one or more target languages, but h# generates
// deterministic target names, so behavior must be unchanged.
fn int(class: i32) -> i32 {
    let func: i32 = class + 1;
    return func;
}
