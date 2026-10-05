/*! @license OpenCode brand mark
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

export const OPENCODE_ICON_ID = "opencode-logo";

// Adapted from the official OpenCode brand mark (240 x 300), centered with
// padding on Obsidian's 100 x 100 custom-icon canvas. Theme color replaces the
// brand colors; the translucent inset preserves the mark's two-tone shape.
// Source: https://github.com/anomalyco/opencode/blob/e3c3786f43d01ff05a35eabe92bb396f9872975b/packages/console/app/src/asset/brand/opencode-logo-light.svg
export const OPENCODE_ICON_SVG = `
<g transform="translate(16.666667 8.333333) scale(0.277777778)" fill="currentColor" stroke="none">
	<path d="M180 240H60V120H180V240Z" opacity="0.35" />
	<path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" />
</g>`;
