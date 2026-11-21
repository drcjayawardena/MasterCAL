#!/usr/bin/env python3
"""Google Sheet export (.xlsx) -> model.json (formulas + constants) for the standalone engine.

Usage: python3 -I extract_model.py MasterCAL_Pro.xlsx model.json

* Google's "__xludf.DUMMYFUNCTION" wrappers are unwrapped to the original formula.
* Google "COMPUTED_VALUE" spill placeholders are dropped (the engine recomputes spills).
* Sheets that hold user data (USERS, APPROVED_USERS) and the 'Formula Dump' helper are never exported.
"""
import sys, re, json, datetime
import openpyxl
from openpyxl.worksheet.formula import ArrayFormula
from openpyxl.utils.datetime import to_excel

SKIP = {"USERS", "APPROVED_USERS", "Formula Dump"}
WRAP = re.compile(r'^=IFERROR\(__xludf\.DUMMYFUNCTION\("((?:[^"]|"")*)"\),', re.S)

def main(src, dst):
    wb = openpyxl.load_workbook(src)
    model = {"sheets": {}, "order": [], "fmts": []}
    fmt_ix = {}
    for ws in wb:
        if ws.title in SKIP:
            continue
        f, v = {}, {}
        stale = set()  # cached members of multi-cell array formulas (the engine recomputes the spill)
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, ArrayFormula) and c.value.ref and ":" in c.value.ref:
                    for r2 in ws[c.value.ref]:
                        for c2 in (r2 if isinstance(r2, tuple) else (r2,)):
                            if c2.coordinate != c.coordinate:
                                stale.add(c2.coordinate)
        for row in ws.iter_rows():
            for c in row:
                x = c.value
                if x is None or c.coordinate in stale:
                    continue
                if isinstance(x, ArrayFormula):
                    x = x.text
                if isinstance(x, str) and x.startswith("="):
                    if "COMPUTED_VALUE" in x:
                        continue
                    m = WRAP.match(x)
                    expr = m.group(1).replace('""', '"') if m else x[1:]
                    f[c.coordinate] = expr.strip()
                elif isinstance(x, (datetime.datetime, datetime.date)):
                    v[c.coordinate] = to_excel(x)
                elif isinstance(x, str):
                    if x != "":
                        v[c.coordinate] = x
                else:
                    v[c.coordinate] = x
        # number formats (non-General) of cells that hold something, or lie in the first 200 rows
        n = {}
        for row in ws.iter_rows(max_row=min(ws.max_row, 200)):
            for c in row:
                nf = c.number_format
                if nf and nf != "General":
                    if nf not in fmt_ix:
                        fmt_ix[nf] = len(model["fmts"]); model["fmts"].append(nf)
                    n[c.coordinate] = fmt_ix[nf]
        for a in list(f) + list(v):
            if a not in n:
                nf = ws[a].number_format
                if nf and nf != "General":
                    if nf not in fmt_ix:
                        fmt_ix[nf] = len(model["fmts"]); model["fmts"].append(nf)
                    n[a] = fmt_ix[nf]
        # data validations (dropdown lists): [{"r": [A1 ranges], "t": type, "f": formula1}]
        dv = []
        if ws.data_validations:
            for d in ws.data_validations.dataValidation:
                if d.type == "list" and d.formula1:
                    dv.append({"r": [str(x) for x in d.sqref.ranges], "f": d.formula1})
        model["sheets"][ws.title] = {"f": f, "v": v, "n": n, "dv": dv, "hidden": ws.sheet_state != "visible"}
        model["order"].append(ws.title)
    json.dump(model, open(dst, "w"), ensure_ascii=False, separators=(",", ":"))
    nf = sum(len(s["f"]) for s in model["sheets"].values())
    nv = sum(len(s["v"]) for s in model["sheets"].values())
    print(f"sheets {len(model['order'])}  formulas {nf}  constants {nv}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
