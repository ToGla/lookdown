# Table harness

An aligned table, 3 columns by 4 rows:

| Name | Qty | Price |
|:-----|:---:|------:|
| Apple | 3 | 1.20 |
| Banana | 12 | 0.45 |
| Cherry | 100 | 12.00 |

Long cells that must wrap inside their column:

| Topic | Notes |
|---|---|
| Wrapping | This is a deliberately long piece of text in one cell so that it has to wrap onto several lines inside its own column and never push the table past the text column. |
| Short | ok |

No outer pipes:

a | b
--|--
c | d
e | f

Ragged row:

| a | b | c |
|---|---|---|
| 1 |
| 2 | 3 |

In a quote:

> | q | r |
> |---|---|
> | s | t |

Inline styling and an escaped pipe:

| Style | Value |
|---|---|
| **bold** and *em* | `code` and [link](https://example.com) |
| a \| b | ~~gone~~ |
