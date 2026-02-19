# Reading Rules Guide

This document explains how to add custom reading rules for special cases
like "何を" and date expressions such as "1日".

Rules are defined in:
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/ReadingRules.swift`

## Overview

The pipeline is:
1. CFStringTokenizer reading
2. Long-unit tokenization (merging)
3. Reading override rules (this file)

Rules are applied in this order:
1. Sequence rules (merge adjacent tokens)
2. Surface rules (exact match)
3. Regex rules (pattern + context)

## Rule Types

### 1. SequenceRule
Merge multiple adjacent tokens into a single token and override reading.

Fields:
- `id`: Unique identifier
- `priority`: Higher runs first
- `surfaces`: Exact surface sequence to match
- `reading`: Reading to apply to the merged token
- `context`: Optional previous/next token constraints

Example:
```
SequenceRule(id: "nani-wo-seq", priority: 100, surfaces: ["何", "を"], reading: "なにを", context: nil)
```

Example (context-aware sequence):
```
SequenceRule(
    id: "example-seq",
    priority: 80,
    surfaces: ["A", "B"],
    reading: "エービー",
    context: RuleContext(prevPattern: "X", prevPrevPattern: nil, nextPattern: nil)
)
```

### 2. SurfaceRule
Override reading when token surface exactly matches.

Fields:
- `id`
- `priority`
- `surface`
- `reading`

Example:
```
SurfaceRule(id: "nani-wo-surface", priority: 90, surface: "何を", reading: "なにを")
```

### 3. RegexRule
Override reading when surface matches a regex, with optional context.

Fields:
- `id`
- `priority`
- `pattern`: Regex for the current token surface
- `reading`
- `context`: Optional previous/next token constraints

Context fields:
- `prevPattern`: Regex that must match the previous token surface
- `prevPrevPattern`: Regex that must match the token before the previous one
- `nextPattern`: Regex that must match the next token surface

Example (month + day in context):
```
RegexRule(
    id: "month-day-token",
    priority: 135,
    pattern: "^([1-9]|[12][0-9]|3[01]|[１-９]|[１２][０-９]|３[０-１])日$",
    reading: "$1にち",
    context: RuleContext(prevPattern: "^(1[0-2]|[1-9]|１[０-２]|[１-９])月$", prevPrevPattern: nil, nextPattern: nil)
)
```

Example (month):
```
RegexRule(
    id: "month-number",
    priority: 130,
    pattern: "^(1[0-2]|[1-9]|１[０-２]|[１-９])月$",
    reading: "$1がつ",
    context: nil
)
```

Example (month with punctuation):
```
RegexRule(
    id: "month-number-with-punct",
    priority: 131,
    pattern: "^(1[0-2]|[1-9]|１[０-２]|[１-９])月([、。,.，．])$",
    reading: "$1がつ$2",
    context: nil
)
```

Example (combined month + day):
```
RegexRule(
    id: "month-day-combined",
    priority: 140,
    pattern: "^(1[0-2]|[1-9]|１[０-２]|[１-９])月([1-9]|[12][0-9]|3[01]|[１-９]|[１２][０-９]|３[０-１])日$",
    reading: "$1がつ$2にち",
    context: nil
)
```

Example (month + day split across tokens):
```
RegexRule(
    id: "month-day-split",
    priority: 134,
    pattern: "^日$",
    reading: "にち",
    context: RuleContext(
        prevPattern: "^([1-9]|[12][0-9]|3[01]|[１-９]|[１２][０-９]|３[０-１])$",
        prevPrevPattern: "^(1[0-2]|[1-9]|１[０-２]|[１-９])月$",
        nextPattern: nil
    )
)
```

Example (numeric day):
```
RegexRule(
    id: "nichi-generic",
    priority: 100,
    pattern: "^([1-9]|[12][0-9]|3[01]|[１-９]|[１２][０-９]|３[０-１])日$",
    reading: "$1にち",
    context: nil
)
```

Example (day duration):
```
RegexRule(
    id: "nichi-duration",
    priority: 105,
    pattern: "^([1-9]|[12][0-9]|3[01]|[１-９]|[１２][０-９]|３[０-１])日間$",
    reading: "$1にちかん",
    context: nil
)
```

Example (split numeric + 日):
```
RegexRule(
    id: "nichi-split",
    priority: 99,
    pattern: "^日$",
    reading: "にち",
    context: RuleContext(prevPattern: "^([1-9]|[12][0-9]|3[01]|[１-９]|[１２][０-９]|３[０-１])$", prevPrevPattern: nil, nextPattern: nil)
)
```

Note:
- Regex `reading` supports `$1`, `$2` capture groups.

Example (day duration):
```
RegexRule(
    id: "nichi-duration",
    priority: 105,
    pattern: "^([1-9]|[12][0-9]|3[01]|[１-９]|[１２][０-９]|３[０-１])日間$",
    reading: "$1にちかん",
    context: nil
)
```

## Adding a New Rule

1. Open:
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/ReadingRules.swift`
2. Add a new rule to the appropriate array:
   - `sequenceRules`
   - `surfaceRules`
   - `regexRules`
3. Keep `priority` higher for more specific rules.

## Notes

- Regex is applied to **token surfaces**, not raw page text.
- Context only checks immediate previous/next tokens.
- If you add a new Swift file, make sure it is included in the extension target.
