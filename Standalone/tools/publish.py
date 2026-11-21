#!/usr/bin/env python3
"""Google Sheet export (.xlsx)  ->  MasterCAL_Pro_Standalone.html

  python3 -I publish.py MasterCAL_Pro.xlsx MasterCAL_Pro_Standalone.html

1. extract_model.py  : formulas, values, number formats, dropdown lists
2. check_model.js    : engine vs Google's cached values (+ unsupported functions)
3. build_standalone.js: one self-contained HTML
"""
import sys, os, json, subprocess, tempfile
import openpyxl
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_model

HERE = os.path.dirname(os.path.abspath(__file__))

def main(src, dst):
    tmp = tempfile.mkdtemp()
    model_p, cache_p = os.path.join(tmp, "model.json"), os.path.join(tmp, "cached.json")
    extract_model.main(src, model_p)
    g = openpyxl.load_workbook(src, data_only=True)
    cached = {}
    for ws in g:
        d = {}
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None:
                    d[c.coordinate] = c.value if isinstance(c.value, (int, float, str, bool)) else str(c.value)
        cached[ws.title] = d
    json.dump(cached, open(cache_p, "w"))
    rc = subprocess.call(["node", os.path.join(HERE, "check_model.js"), model_p, cache_p])
    subprocess.check_call(["node", os.path.join(HERE, "build_standalone.js"), model_p, dst])
    print("RESULT:", "OK" if rc == 0 else "CHECK THE WARNINGS ABOVE before sharing the file")
    return rc

if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
