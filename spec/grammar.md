# Uni Grammar (0.1)

The POC has one family, `braces`. Keywords are supplied by the active profile; all other terminals are fixed.

## Lexical elements

```text
identifier   = (letter | "_") , { letter | digit | "_" } ;
integer      = digit , { digit } ;
line-comment = "//" , { any character except newline } ;
whitespace   = spaces | tabs | CR | LF ;

letter       = "A" .. "Z" | "a" .. "z" ;
digit        = "0" .. "9" ;
```

Identifiers are ASCII. Type names `i32` and `bool` are reserved tokens. Canonical keyword words remain reserved even when a profile remaps the role. A canonical word is not usable as an identifier under any profile.

Punctuation and operators:

```text
( ) { } : ; , = + - * ! < > -> == != <= >= && ||
```

Division, modulo, strings, and block comments are not part of the core and are rejected.

## Grammar

Keywords below are written in their canonical spelling. Under a profile, each stands for the profile's word for that role.

```text
program      = { function } EOF ;
function     = "fn" identifier "(" [ parameters ] ")" "->" type block ;
parameters   = parameter { "," parameter } ;
parameter    = identifier ":" type ;
type         = "i32" | "bool" ;

block        = "{" { statement } "}" ;
statement    = let-statement | if-statement | return-statement ;

let-statement = "let" identifier ":" type "=" expression ";" ;

if-statement  = "if" expression block [ "else" ( block | if-statement ) ] ;

return-statement = "return" expression ";" ;

expression   = or-expression ;
or-expression = and-expression { "||" and-expression } ;
and-expression = equality-expression { "&&" equality-expression } ;
equality-expression = ordering-expression { ( "==" | "!=" ) ordering-expression } ;
ordering-expression = additive-expression { ( "<" | "<=" | ">" | ">=" ) additive-expression } ;
additive-expression = multiplicative-expression { ( "+" | "-" ) multiplicative-expression } ;
multiplicative-expression = unary-expression { "*" unary-expression } ;
unary-expression = ( "-" | "!" ) unary-expression | primary-expression ;
primary-expression =
      integer
    | "true"
    | "false"
    | identifier [ "(" [ arguments ] ")" ]
    | "(" expression ")" ;
arguments    = expression { "," expression } ;
```

## Notes

- Calls apply only to an identifier directly followed by `(`.
- Trailing commas are not accepted.
- `else if` is parsed as an `else` block containing a nested `if`.
- The same precedence table appears normatively in [`core.md`](core.md#32-precedence-and-associativity).
- Chained comparisons are rejected by the parser. Explicit parentheses around each comparison permit Boolean equality, e.g. `(1 < 2) == (3 < 4)`.
- The lexer keeps whitespace and comments in the token stream for lossless keyword conversion. The parser ignores them.
