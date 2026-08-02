# Font licences

This directory holds fonts under **two different licences**. Know which is which
before you ship.

| | Font | Licence | Free to bundle? |
|---|---|---|---|
| 30 files | Cinzel, Cinzel Decorative, Crimson Pro, Source Sans 3, IM Fell English | SIL OFL 1.1 | **Yes**, with this file |
| 1 file | `ackssymbols-regular.woff2` | Autarch grant | **Only in authorised ACKS modules** |

**If your module ships `fonts/`, ship this file too.** That is the OFL's one hard
requirement, and it is also where the Acks Symbols terms are recorded.

---

## Acks Symbols — NOT open licence

`ackssymbols-regular.woff2` — *Acks Symbols Regular*, version 001.004, 4.7 KB,
13 glyphs. Autarch's own damage-type symbol set, converted here from the
author-supplied `AcksSymbols-Regular.ttf` to WOFF2 with no other modification.

> **Terms as provided:** the author provided the symbols for use in authorised
> modules as needed.

What that means in practice:

- **Authorised ACKS modules may ship it.** The `acks-*` family qualifies.
- **A module outside that grant must not.** Drop the
  `@import url("./components/glyphs.css")` line from
  `styles/acks-design.css` and the `.woff2` file; nothing else depends on them.
  `.acks-dmg-fallback` substitutes a neutral lozenge so inline damage
  expressions keep their rhythm.
- **It is not OFL and not sublicensable.** Do not relabel it, fold it into
  another icon font, or present it as open. If your situation isn't clearly
  inside the grant, ask Autarch rather than assuming.

The glyph-to-letter mapping is documented in `../docs/EXTRACTION.md` §6 and bound
to semantic class names in `../styles/components/glyphs.css`.

---

## SIL OFL 1.1 fonts

The five text families below are open-licence and free to bundle, including in
commercial modules.

### Copyright holders

| Family | Copyright | Reserved Font Name |
|---|---|---|
| Cinzel | Copyright (c) 2012, Natanael Gama (`nsgama@gmail.com`) | Cinzel |
| Cinzel Decorative | Copyright (c) 2012, Natanael Gama (`nsgama@gmail.com`) | Cinzel Decorative |
| Crimson Pro | Copyright (c) 2018, Jacques Le Bailly; based on Crimson Text by Sebastian Kosch | Crimson Pro |
| Source Sans 3 | Copyright (c) 2010-2024, Adobe (`https://adobe.com`) | Source |
| IM Fell English | Copyright (c) 2010, Igino Marini (`www.iginomarini.com`) | IM FELL |

The faces they stand in for — Minion Pro, Cronos Pro, Trajan Pro 3, Imperator
Small Caps, Broadsheet and Archeologicaps — are commercial and are **not**
included here in any form. See `../docs/FONT-MAPPING.md`.

### SIL Open Font License v1.1

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
