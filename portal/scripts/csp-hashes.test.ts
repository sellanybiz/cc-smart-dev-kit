import { describe, expect, test } from "bun:test";
import { cspHashes, decodeAttribute } from "./csp-hashes";

// The expected hashes were made outside this code: `printf '%s' '<text>' | openssl dgst -sha256
// -binary | base64`, so a wrong hash, a wrong decoding or a wrong match all fail here.
const OUTLINE_NONE = "'sha256-MtxTLcyxVEJFNLEIqbVTaqR4WWr0+lYSZ78AzGmNsuA='";
const COLOR_QUOTED = "'sha256-SkhGaXvJ+4hQy76U72eCF3GP8c6oHUE1R6FPe6FUues='";
const MARGIN_ZERO = "'sha256-q3nqK4VzeI/SowYCYQ/tCfo056B/JMutuSpzbJbHczk='";
const STYLE_BODY = "'sha256-AYkV/wUaXEz1i9pndN1veIXFHZVFTj4Ojce2rMK7bSc='";

const PAGE_ONE = `<!DOCTYPE html><html><head><style>.a{color:red}</style></head><body>
<div tabindex="-1" style="outline:none" data-style="ignored"></div>
<span style="color:&quot;red&quot;">quoted</span>
<p data-x="style=&quot;no&quot;">not an attribute</p>
<script id="__NEXT_DATA__" type="application/json">{"style":"x"}</script>
</body></html>`;

const PAGE_TWO = `<html><body><ul style='margin:0'><li style="outline:none">twice</li></ul></body></html>`;

describe("cspHashes", () => {
  test("hashes every style attribute and <style> body once, sorted", () => {
    expect(cspHashes([PAGE_ONE, PAGE_TWO])).toEqual({
      styleAttr: [MARGIN_ZERO, OUTLINE_NONE, COLOR_QUOTED].sort(),
      styleElem: [STYLE_BODY],
    });
  });

  test("a page with neither gives empty lists", () => {
    expect(cspHashes(["<html><body><p class='x'>plain</p></body></html>"])).toEqual({
      styleAttr: [],
      styleElem: [],
    });
  });

  test("an attribute is hashed as the browser reads it, after its character references", () => {
    expect(decodeAttribute("a&amp;b&#39;c&#x22;d&lt;")).toBe("a&b'c\"d<");
  });
});
