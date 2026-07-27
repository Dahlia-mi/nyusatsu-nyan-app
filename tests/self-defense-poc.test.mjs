import assert from "node:assert/strict";
import test from "node:test";
import { extractNotices } from "../scripts/self-defense-poc.mjs";

const fixture = `<!doctype html><html><body><table>
<tr><td>年度</td><td>番号</td><td>公告日</td><td>件名</td>
<td colspan="3">添付</td><td>受付始期</td><td>受付終期</td></tr>
<tr><td>8</td><td></td><td>2026/07/24</td>
<td><a href="koubo/main.pdf">松本 事務用品一式</a></td>
<td><a href="koubo/spec.pdf">添付ファイル1</a></td>
<td><a href="koubo/list.xlsx">添付ファイル2</a></td>
<td></td><td>2026/07/24</td><td>2026/08/06</td></tr>
<tr><td>8</td><td></td><td>2026/07/25</td>
<td><a href="koubo/other.pdf">清掃役務</a></td>
<td></td><td></td><td></td><td>2026/07/25</td><td>2026/08/07</td></tr>
</table></body></html>`;

test("extracts table fields, resolves links, and prioritizes keywords", () => {
  const notices = extractNotices(fixture);

  assert.equal(notices.length, 2);
  assert.equal(notices[0].priority, true);
  assert.deepEqual(notices[0].matchedKeywords, ["松本", "事務用品"]);
  assert.equal(notices[0].deadline, "2026/08/06");
  assert.equal(notices[0].attachmentLinks.length, 3);
  assert.match(notices[0].attachmentLinks[0], /\/koubo\/main\.pdf$/);
  assert.equal(notices[1].priority, false);
});
