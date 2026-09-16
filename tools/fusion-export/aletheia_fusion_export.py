# Aletheia — read-only Fusion metadata export
#
# A Fusion 360 add-in / script. It does NOT create geometry or change the model.
# It walks the *active design* and writes one JSON array of CadDoc rows that the
# Aletheia CAD connector (lib/connectors/cad/) ingests read-only:
#   config.cad.systems.fusion.exportFile  ->  npm run connectors:cad
#
# Run:  Fusion → Utilities → Add-Ins → Scripts and Add-Ins → add this folder,
#       select "aletheia_fusion_export", Run. Pick where to save the .json.

import adsk.core
import adsk.fusion
import traceback
import json
import datetime


def _num(x):
    try:
        return round(float(x), 6)
    except Exception:
        return None


def _physical(comp):
    """mass (kg), volume (cm^3), bounding box (cm) — low accuracy, no recompute."""
    out = {}
    try:
        pp = comp.getPhysicalProperties(adsk.fusion.CalculationAccuracy.LowCalculationAccuracy)
        if pp:
            out["mass_kg"] = _num(pp.mass)
            out["volume_cm3"] = _num(pp.volume)
            out["area_cm2"] = _num(pp.area)
    except Exception:
        pass
    try:
        bb = comp.boundingBox
        if bb:
            d = [_num(bb.maxPoint.x - bb.minPoint.x),
                 _num(bb.maxPoint.y - bb.minPoint.y),
                 _num(bb.maxPoint.z - bb.minPoint.z)]
            if all(v is not None for v in d):
                out["bbox_cm"] = "{} x {} x {}".format(*d)
    except Exception:
        pass
    return out


def _attributes(comp):
    props = {}
    try:
        for attr in comp.attributes:
            key = (attr.groupName + "." + attr.name) if attr.groupName else attr.name
            props[key] = str(attr.value)
    except Exception:
        pass
    return props


def _bom(comp):
    """Direct child components → [{partNumber, description, quantity}]."""
    counts = {}
    meta = {}
    try:
        for occ in comp.occurrences:
            child = occ.component
            if not child:
                continue
            pn = (child.partNumber or child.name or "").strip()
            if not pn:
                continue
            counts[pn] = counts.get(pn, 0) + 1
            meta.setdefault(pn, child.description or "")
    except Exception:
        pass
    return [{"partNumber": pn, "description": meta.get(pn, ""), "quantity": n}
            for pn, n in sorted(counts.items())]


def _doc_meta(app):
    """Version / author / date from the saved data file, if any."""
    m = {"revision": "", "modifiedBy": "", "modifiedAt": "", "name": ""}
    try:
        doc = app.activeDocument
        m["name"] = doc.name or ""
        df = getattr(doc, "dataFile", None)
        if df:
            try:
                m["revision"] = "v" + str(df.versionNumber)
            except Exception:
                pass
            try:
                m["modifiedBy"] = df.lastUpdatedBy.displayName
            except Exception:
                pass
            for fld in ("dateModified", "dateCreated"):
                try:
                    ts = getattr(df, fld, None)
                    if ts:
                        m["modifiedAt"] = datetime.datetime.utcfromtimestamp(ts).isoformat() + "Z"
                        break
                except Exception:
                    pass
    except Exception:
        pass
    return m


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox("Open a Fusion design first, then run this script.")
            return

        dm = _doc_meta(app)
        doc_name = dm["name"] or "Untitled"

        # where to use: partNumber -> assemblies that contain it
        where_used = {}
        for comp in design.allComponents:
            for occ in comp.occurrences:
                cp = (occ.component.partNumber or occ.component.name or "").strip()
                if cp:
                    where_used.setdefault(cp, set()).add((comp.partNumber or comp.name or "").strip())

        rows = []
        for comp in design.allComponents:
            pn = (comp.partNumber or comp.name or "").strip()
            is_asm = False
            try:
                is_asm = comp.occurrences.count > 0
            except Exception:
                pass
            bom = _bom(comp) if is_asm else []
            props = _attributes(comp)
            props.update(_physical(comp))
            row = {
                "name": doc_name if comp is design.rootComponent else (comp.name + " [in " + doc_name + "]"),
                "Part Number": pn,
                "Description": comp.description or "",
                "Type": "Assembly" if is_asm else "Part",
                "Material": (comp.material.name if comp.material else ""),
                "Revision": dm["revision"] if comp is design.rootComponent else "",
                "State": "",  # Fusion has no PDM workflow state
                "Configuration": "",
                "Last Modified By": dm["modifiedBy"] if comp is design.rootComponent else "",
                "Last Modified": dm["modifiedAt"] if comp is design.rootComponent else "",
                "children": bom,
                "whereUsed": sorted(x for x in where_used.get(pn, set()) if x and x != pn),
                "drawings": [],
                "Notes": "",
                "props": {k: v for k, v in props.items() if v not in ("", None)},
            }
            rows.append(row)

        # design parameters as their own pseudo-doc (searchable)
        params = {}
        try:
            for p in design.userParameters:
                params[p.name] = "{} = {}{}".format(p.name, p.expression, ("  (" + p.comment + ")") if p.comment else "")
        except Exception:
            pass
        if params:
            rows.append({
                "name": doc_name + " — parameters",
                "Part Number": (rows[0]["Part Number"] + "-PARAMS") if rows else (doc_name + "-PARAMS"),
                "Description": "Design parameters for " + doc_name,
                "Type": "Part",
                "Material": "", "Revision": dm["revision"], "State": "", "Configuration": "",
                "Last Modified By": dm["modifiedBy"], "Last Modified": dm["modifiedAt"],
                "children": [], "whereUsed": [rows[0]["Part Number"]] if rows else [],
                "drawings": [], "Notes": "\n".join(params.values()),
                "props": {},
            })

        dlg = ui.createFileDialog()
        dlg.title = "Save Aletheia CAD export"
        dlg.filter = "JSON (*.json)"
        dlg.initialFilename = "fusion-export.json"
        if dlg.showSave() != adsk.core.DialogResults.DialogOK:
            return
        with open(dlg.filename, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=2)

        ui.messageBox(
            "Wrote {} row(s) to:\n{}\n\nPoint config.cad.systems.fusion.exportFile at it, "
            "then: npm run connectors:cad".format(len(rows), dlg.filename)
        )
    except Exception:
        if ui:
            ui.messageBox("Aletheia Fusion export failed:\n{}".format(traceback.format_exc()))
