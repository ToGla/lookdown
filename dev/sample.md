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
| Unbreakable | https://example.com/a/very/long/path/without/any/spaces/that/would/otherwise/widen/the/table/past/the/text/column.html and `a_very_long_inline_code_token_without_any_break_opportunities_at_all_anywhere` |

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

# Image harness

A PNG: ![lookdown icon](images/icon.png)

An SVG, with a space-free relative path: ![a shape](./images/shape.svg)

A missing image: ![no such file](images/missing.png)

A web image (not loaded): ![remote](https://example.com/picture.png)

A web image that loads on Load image: ![w3c](https://www.w3.org/Icons/w3c_home.png)

An image inside a link (Mod+click opens it): [![linked icon](images/icon.png)](https://example.com)

Two images on one line: ![first](images/icon.png) and ![second](images/shape.svg)

## A heading with an image ![heading icon](images/icon.png)

- A list item with an image ![list icon](images/icon.png)

> A quote with an image ![quote shape](images/shape.svg)

An image in a table cell:

| Picture | Caption |
|---|---|
| ![cell icon](images/icon.png) | shown as a chip |
