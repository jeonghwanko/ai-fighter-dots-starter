"""AI Fighter's explicit, review-bound extension of the pinned motion inspector.

The upstream report is retained verbatim. Version 1 evidence resolves only its
two-lobe ambiguity, with fresh per-frame anatomical-foot outlines, both contact
landmarks on the bottom band, a shallow sole arch, and all other upstream checks
passing. Version 2 evidence also covers padded, hoofed or clawed soles and lifted
heels (digitigrade feet, heel-off): any number of contact lobes of the one outlined
foot that close within the same shallow depth, and travel measured at the leading
ground contact instead of the ROI silhouette centroid, with the upstream formulas.
Baseline, ROI-boundary, single-shape and pose-count checks are never resolved.
This is conditional authoring evidence, not automatic anatomy recognition or a
security certificate. No source image, timing, upstream module or report is patched.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw
from sprite_gen.qa.motion import analyze_motion
from sprite_gen.spec.assets import load_asset
from sprite_gen.spec.runio import acquire_run_dir_lock, atomic_write_set, release_run_dir_lock

ENGINES = {1: "ai-fighter-foot-evidence-v1", 2: "ai-fighter-foot-evidence-v2"}
LOBE_REASON = "multiple contact lobes in foot ROI"
LOBE_CODE = "foot-contact-lobes"
REVIEW_KEYS = ("sameAnatomicalFoot", "completeFoot", "otherFootExcluded", "groundContact")
# Upstream reasons that only proxy foot identity or travel through the ROI silhouette.
# With v2 evidence the outlines answer identity and the leading contact track answers
# travel. Every other upstream reason, including any added later, stays a failure.
# Decided on the engine's stable codes (sprite_gen.qa.motion STANCE_REASONS): its texts may be reworded.
SILHOUETTE_PROXY_CODES = (
    LOBE_CODE,
    "foot-centroid-moves",
    "foot-area-changes",
    "foot-dimensions-change",
    "horizontal-reversal",
    "no-net-displacement",
    "velocity-inconsistent",
)
# The texts an engine without `reason_codes` gave for those codes (sprite-gen before f12cdcc).
SILHOUETTE_PROXY_REASONS = (
    LOBE_REASON,
    "foot centroid moves vertically; stance is uncertain",
    "foot silhouette area changes; tracking identity is uncertain",
    "foot silhouette dimensions change; tracking identity is uncertain",
    "horizontal reversal",
    "insufficient net horizontal displacement",
    "foot velocity is inconsistent across the declared stance",
)
LEGACY_CODES = dict(zip(SILHOUETTE_PROXY_REASONS, SILHOUETTE_PROXY_CODES))


def reason_codes(candidate):
    """The code of each of an upstream candidate's reasons, in order; None for a text no code is known for (a failure)."""
    codes = candidate.get("reason_codes")
    if isinstance(codes, list) and len(codes) == len(candidate["reasons"]):
        return list(codes)
    return [LEGACY_CODES.get(reason) for reason in candidate["reasons"]]


def pixel_binding(sequence):
    # Independent of paths/PNG encoding, but sensitive to every pixel and duration.
    return {"size": list(sequence.frames[0].size),
            "rgbaSha256": [hashlib.sha256(f.convert("RGBA").tobytes()).hexdigest() for f in sequence.frames],
            "durationsSeconds": list(sequence.durations)}


def _stance(sequence, foot, start, end, box, facing):
    if foot not in ("near", "far") or facing not in ("left", "right"):
        raise ValueError("Explicit near/far foot and left/right facing are required")
    if type(start) is not int or type(end) is not int or not 0 <= start <= end - 2 or end >= len(sequence.frames):
        raise ValueError("One stance needs at least three consecutive frames inside the sequence")
    # The official inspector validates the ROI and source geometry/timing.
    analyze_motion(sequence, contacts=[(start, end)], foot_box=box, facing=facing)
    return {"foot": foot, "start": start, "end": end, "box": list(box), "facing": facing}


def template(sequence, foot, start, end, box, facing, version=2):
    stance = _stance(sequence, foot, start, end, box, facing)
    if version not in ENGINES:
        raise ValueError("Unknown foot-evidence version")
    return {"kind": "ai-fighter-foot-evidence", "version": version, "sequence": pixel_binding(sequence),
            "stance": stance,
            "review": {"reviewer": "", "method": "visual-per-frame", "notes": "",
                       **{key: "unverified" for key in REVIEW_KEYS}},
            "frames": [{"frame": i, "nearOutline": [], "farOutline": [], "heel": [], "forefoot": []}
                       for i in range(start, end + 1)]}


def _point(value, size):
    return (isinstance(value, list) and len(value) == 2 and all(type(n) is int for n in value)
            and 0 <= value[0] < size[0] and 0 <= value[1] < size[1])


def _segments_intersect(a, b, c, d):
    def cross(p, q, r):
        return (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0])
    def on(p, q, r):
        return min(p[0],q[0]) <= r[0] <= max(p[0],q[0]) and min(p[1],q[1]) <= r[1] <= max(p[1],q[1])
    p, q, r, s = cross(a,b,c), cross(a,b,d), cross(c,d,a), cross(c,d,b)
    return ((p*q < 0 and r*s < 0) or (p == 0 and on(a,b,c)) or (q == 0 and on(a,b,d))
            or (r == 0 and on(c,d,a)) or (s == 0 and on(c,d,b)))


def _outline(points, size):
    if not isinstance(points, list) or not 3 <= len(points) <= 128 or not all(_point(p,size) for p in points):
        raise ValueError("Each complete-foot outline needs 3–128 integer vertices inside the canvas")
    if len({tuple(p) for p in points}) != len(points):
        raise ValueError("Outline vertices must be distinct; do not repeat the first vertex")
    edges = list(zip(points, points[1:] + points[:1]))
    if abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in edges)) < 8:
        raise ValueError("Foot outline has insufficient area")
    for i,(a,b) in enumerate(edges):
        for j,(c,d) in enumerate(edges):
            if j <= i+1 or (i == 0 and j == len(edges)-1):
                continue
            if _segments_intersect(a,b,c,d):
                raise ValueError("Foot outline self-intersects")
    image = Image.new("1",size)
    ImageDraw.Draw(image).polygon([tuple(p) for p in points],fill=1)
    return np.asarray(image,dtype=bool)


def _components(mask):
    remaining = set(zip(*np.nonzero(mask)))
    count = 0
    while remaining:
        count += 1
        if count > 1:
            return count
        stack = [remaining.pop()]
        while stack:
            y,x = stack.pop()
            for dy in (-1,0,1):
                for dx in (-1,0,1):
                    point = (y+dy,x+dx)
                    if point in remaining:
                        remaining.remove(point); stack.append(point)
    return count


def _intervals(band):
    starts = np.flatnonzero(band & ~np.r_[False,band[:-1]])
    ends = np.flatnonzero(band & ~np.r_[band[1:],False]) + 1
    return [(int(a),int(b)) for a,b in zip(starts,ends)]


def _merge_depth(region, top, bottom, left, right):
    # Fixed, documented conservative sole-shape limits; never CLI knobs.
    limit = min(math.ceil((bottom-top)*.20),math.ceil((right-left)*.12))
    return next((depth for depth in range(3,limit+1)
                 if len(_intervals(region[max(top,bottom-depth):bottom].any(axis=0))) == 1),None)


def _v1_contact(entry, tracked, region, box, size, facing):
    x,y = box[:2]
    defects = []
    ys,xs = np.nonzero(region)
    left,top,right,bottom = int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1
    lobes = _intervals(region[max(top,bottom-2):bottom].any(axis=0))
    heel, forefoot = entry.get("heel"),entry.get("forefoot")
    if not all(_point(p,size) and tracked[p[1],p[0]] and y+bottom-2 <= p[1] < y+bottom for p in (heel,forefoot)):
        defects.append("HEEL_AND_FOREFOOT_MUST_TOUCH_ACTUAL_BOTTOM_BAND")
    else:
        expected_order = heel[0] < forefoot[0] if facing == "right" else heel[0] > forefoot[0]
        if not expected_order:
            defects.append("CONTACT_LANDMARK_FACING")
    merged_depth = None
    if len(lobes) == 2:
        gap = lobes[1][0]-lobes[0][1]
        merged_depth = _merge_depth(region,top,bottom,left,right)
        if gap > (right-left)*.30 or merged_depth is None:
            defects.append("CONTACT_GAP_IS_NOT_A_SHALLOW_SOLE_ARCH")
        if not defects:
            contacts = sorted([heel[0]-x,forefoot[0]-x])
            if not all(a <= p < b for p,(a,b) in zip(contacts,lobes)):
                defects.append("LANDMARKS_MUST_COVER_BOTH_CONTACT_LOBES")
    elif len(lobes) != 1:
        defects.append("UNSUPPORTED_CONTACT_TOPOLOGY")
    return {"lobeCount":len(lobes),"soleMergeDepth":merged_depth,
            "contactLobesX":[[a+x,b+x] for a,b in lobes]}, defects


def _v2_contact(entry, tracked, region, box, size, facing):
    """Pads, hoof walls and claws are lobes of the one outlined foot when they close within
    the v1 shallow-sole limits. The forefoot is on the bottom band; the heel may be lifted."""
    x,y = box[:2]
    defects = []
    ys,xs = np.nonzero(region)
    left,top,right,bottom = int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1
    lobes = _intervals(region[max(top,bottom-2):bottom].any(axis=0))
    merged_depth = None
    if len(lobes) > 1:
        widest_gap = max(b[0]-a[1] for a,b in zip(lobes,lobes[1:]))
        merged_depth = _merge_depth(region,top,bottom,left,right)
        if widest_gap > (right-left)*.30 or merged_depth is None:
            defects.append("CONTACT_GAP_IS_NOT_A_SHALLOW_SOLE_ARCH")
    heel, forefoot = entry.get("heel"),entry.get("forefoot")
    heel_lifted = None
    if not (_point(forefoot,size) and tracked[forefoot[1],forefoot[0]] and y+bottom-2 <= forefoot[1] < y+bottom):
        defects.append("FOREFOOT_MUST_TOUCH_ACTUAL_BOTTOM_BAND")
    elif not (_point(heel,size) and tracked[heel[1],heel[0]]):
        defects.append("HEEL_MUST_BE_ON_THE_TRACKED_FOOT")
    else:
        heel_lifted = heel[1] < y+bottom-2
        if not (heel[0] < forefoot[0] if facing == "right" else heel[0] > forefoot[0]):
            defects.append("CONTACT_LANDMARK_FACING")
    # The forefoot is the last part to leave the ground, so its leading edge stays planted
    # from foot-flat (or toe-down) to toe-off whether or not the heel has lifted.
    leading = lobes[-1][1]-1+x if facing == "right" else lobes[0][0]+x
    return {"lobeCount":len(lobes),"soleMergeDepth":merged_depth,
            "contactLobesX":[[a+x,b+x] for a,b in lobes],"leadingContactX":leading,
            "heelLifted":heel_lifted}, defects


def validate_evidence(sequence, stance, evidence):
    issues, observations = [], []
    if (not isinstance(evidence,dict) or evidence.get("kind") != "ai-fighter-foot-evidence"
            or evidence.get("version") not in ENGINES):
        return ["EVIDENCE_SCHEMA"], observations
    contact = _v1_contact if evidence["version"] == 1 else _v2_contact
    if evidence.get("sequence") != pixel_binding(sequence):
        issues.append("EVIDENCE_STALE_PIXELS_OR_TIMING")
    if evidence.get("stance") != stance:
        issues.append("EVIDENCE_STANCE_MISMATCH")
    review = evidence.get("review")
    if (not isinstance(review,dict) or review.get("method") != "visual-per-frame"
            or not isinstance(review.get("reviewer"),str) or not review["reviewer"].strip()
            or not isinstance(review.get("notes"),str) or len(review["notes"].strip()) < 20
            or any(review.get(key) != "pass" for key in REVIEW_KEYS)):
        issues.append("EVIDENCE_VISUAL_REVIEW_REQUIRED")
    frames = evidence.get("frames")
    expected = list(range(stance["start"],stance["end"]+1))
    if (not isinstance(frames,list) or [f.get("frame") if isinstance(f,dict) else None for f in frames] != expected
            or any(type(f.get("frame")) is not int for f in frames)):
        issues.append("EVIDENCE_FRAME_COVERAGE")
    if issues:
        return issues, observations
    size = sequence.frames[0].size
    x,y,w,h = stance["box"]
    roi = np.zeros((size[1],size[0]),dtype=bool); roi[y:y+h,x:x+w] = True
    tracked_name = stance["foot"] + "Outline"
    other_name = ("far" if stance["foot"] == "near" else "near") + "Outline"
    for entry in frames:
        index = entry["frame"]
        defects = []
        alpha = np.asarray(sequence.frames[index].convert("RGBA"))[:,:,3] > 0
        try:
            tracked = _outline(entry.get(tracked_name),size) & alpha
            other = _outline(entry.get(other_name),size) & alpha
        except ValueError as error:
            issues.append(f"FRAME_{index}: {error}"); continue
        if _components(tracked) != 1 or _components(other) != 1:
            defects.append("FOOT_OUTLINES_MUST_EACH_IDENTIFY_ONE_CONNECTED_FOOT")
        if (tracked & other).any():
            defects.append("FOOT_IDENTITY_OVERLAP")
        if (other & roi).any():
            defects.append("OTHER_FOOT_IN_ROI")
        if (tracked & ~roi).any():
            defects.append("COMPLETE_FOOT_CLIPPED_BY_ROI")
        if (alpha & roi & ~tracked).any():
            defects.append("UNASSIGNED_FOREGROUND_IN_ROI")
        if defects:
            issues.extend(f"FRAME_{index}: {d}" for d in defects); continue
        observation, defects = contact(entry,tracked,alpha[y:y+h,x:x+w],stance["box"],size,stance["facing"])
        observations.append({"frame":index,**observation,"issues":defects})
        issues.extend(f"FRAME_{index}: {d}" for d in defects)
    return issues, observations


def contact_track(candidate, observations):
    """Upstream's travel formulas, applied to the measured leading contact edge.

    Same pose-onset frames and timestamps, endpoint velocity, reversal/net-displacement
    tests and RMSE tolerance as sprite-gen's stance candidate. Only the tracked x differs.
    """
    lead = {o["frame"]:o["leadingContactX"] for o in observations}
    onsets = candidate.get("pose_onset_frames") or []
    starts = {s["frame"]:s["time_seconds"] for s in candidate["samples"]}
    if len(onsets) < 3 or any(f not in lead for f in onsets):
        return None
    xs = np.array([lead[f] for f in onsets],dtype=float)
    times = np.array([starts[f] for f in onsets],dtype=float)
    velocity = float(xs[-1]-xs[0])/float(times[-1]-times[0])
    deltas = np.diff(xs)
    residuals = xs-(xs[0]+velocity*(times-times[0]))
    rmse, tolerance = float(np.sqrt(np.mean(residuals**2))), max(.5,float(np.ptp(xs))*.1)
    reasons = []
    if (deltas > .25).any() and (deltas < -.25).any():
        reasons.append("leading contact: horizontal reversal")
    if abs(float(xs[-1]-xs[0])) < 1:
        reasons.append("leading contact: insufficient net horizontal displacement")
    if rmse > tolerance:
        reasons.append("leading contact: velocity is inconsistent across the declared stance")
    return {"frames":onsets,"leadingContactX":xs.tolist(),"timesSeconds":times.tolist(),
            "velocityPxPerSecond":velocity if math.isfinite(velocity) else None,
            "fitRmsePx":rmse,"toleranceRmsePx":tolerance,"reasons":reasons}


def inspect(sequence, foot, start, end, box, facing, evidence):
    stance = _stance(sequence,foot,start,end,box,facing)
    upstream = analyze_motion(sequence,contacts=[(start,end)],foot_box=box,facing=facing)
    issues, observations = validate_evidence(sequence,stance,evidence)
    version = evidence.get("version") if isinstance(evidence,dict) and evidence.get("version") in ENGINES else 2
    result = copy.deepcopy(upstream)
    candidate = result["contact_candidates"][0]
    original_reasons = list(candidate["reasons"])
    reasons = list(zip(original_reasons, reason_codes(candidate)))
    # Never replace another failed check or use a reviewer-provided speed.
    track = None
    if version == 1:
        resolvable = {LOBE_CODE}
        speed = candidate.get("measured_velocity_candidate_px_per_second")
        failures = [reason for reason, code in reasons if code not in resolvable]
    else:
        resolvable = set(SILHOUETTE_PROXY_CODES)
        track = contact_track(candidate,observations) if not issues else None
        speed = track["velocityPxPerSecond"] if track else None
        failures = [reason for reason, code in reasons if code not in resolvable] + (track["reasons"] if track else [])
    verified = (not issues and not failures and isinstance(speed,(int,float)) and math.isfinite(speed)
                and all(code in resolvable for _reason, code in reasons))
    resolved = [reason for reason, code in reasons if code in resolvable] if verified else []
    candidate["reasons"] = [] if verified else original_reasons + (track["reasons"] if track else []) + issues
    # The engine's codes name its own reasons only; this candidate's reasons are the kit's (upstream_report keeps them).
    candidate.pop("reason_codes", None)
    candidate.update(status="verified" if verified else "needs-review",confidence=.9 if verified else 0.,
                     foot_velocity_px_per_second=speed if verified else None,
                     stride_px_per_second=abs(speed) if verified else None)
    result.update(status="verified" if verified else "needs-review",stride_verified=verified,
                  confidence=.9 if verified else 0.,foot_velocity_px_per_second=speed if verified else None,
                  stride_px_per_second=abs(speed) if verified else None)
    result["upstream_report"] = upstream
    result["measurement_engine"] = ENGINES[version]
    result["foot_evidence"] = {"status":"verified" if not issues else "unverified", "stance":stance,
                               "sequence":pixel_binding(sequence),"review":evidence.get("review") if isinstance(evidence,dict) else None,
                               "issues":issues,"observations":observations,"declaration":copy.deepcopy(evidence),
                               "resolvedReason":next((reason for reason, code in reasons if code == LOBE_CODE), None) if verified else None}
    if version == 2:
        result["foot_evidence"].update(resolvedReasons=resolved,contactTrack=track)
    result["warnings"] = ["Conditional on explicit reviewer-labelled complete anatomical feet; not automatic foot recognition."]
    if not verified:
        result["warnings"].append("Contact evidence or an upstream stance check failed; stride remains unverified.")
    result["method"]["contact"] += (" AI Fighter foot-evidence v1 checks both labelled foot outlines and shallow heel/forefoot arch evidence; upstream report retained."
        if version == 1 else
        " AI Fighter foot-evidence v2 checks both labelled foot outlines, groups shallow sole lobes of the one outlined foot, accepts a lifted heel with the forefoot on the bottom band, and measures travel at the leading contact edge with the upstream formulas; upstream report retained.")
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=("template","inspect"))
    parser.add_argument("--source",type=Path,required=True)
    parser.add_argument("--state")
    parser.add_argument("--contacts",required=True,help="One inclusive same-foot span, e.g. 1:3")
    parser.add_argument("--foot-box",required=True)
    parser.add_argument("--foot",choices=("near","far"),required=True)
    parser.add_argument("--facing",choices=("left","right"),required=True)
    parser.add_argument("--foot-evidence",type=Path)
    parser.add_argument("--evidence-version",type=int,choices=sorted(ENGINES),default=2,
                        help="template only: 2 (default) also covers padded/hoofed soles and lifted heels; 1 is the boot-only rule")
    parser.add_argument("--out",type=Path,required=True)
    args=parser.parse_args()
    try:
        start,end=map(int,args.contacts.split(":")); box=list(map(int,args.foot_box.split(",")))
        sequence=load_asset(args.source,state=args.state)
        output=args.out.resolve()
        protected=[args.source.resolve(),*(Path(p).resolve() for p in sequence.source_files)]
        if args.foot_evidence:
            protected.append(args.foot_evidence.resolve())
        if (output in protected or (output.exists() and any(p.exists() and output.samefile(p) for p in protected))
                or output.name == ".sprite-gen.lock" or output.name.endswith(".sg-rwlock")):
            raise ValueError("Output must not overwrite source, evidence or lock files")
        if args.command == "template":
            if output.exists():
                raise ValueError("Template already exists; preserve the reviewer's evidence")
            result=template(sequence,args.foot,start,end,box,args.facing,args.evidence_version)
        else:
            if args.foot_evidence is None:
                raise ValueError("inspect requires --foot-evidence; use official inspect-motion for the default route")
            raw=args.foot_evidence.read_bytes()
            result=inspect(sequence,args.foot,start,end,box,args.facing,json.loads(raw.decode("utf-8-sig")))
            result["foot_evidence"].update(file=str(args.foot_evidence.resolve()),sha256=hashlib.sha256(raw).hexdigest())
        output.parent.mkdir(parents=True,exist_ok=True)
        acquire_run_dir_lock(output.parent,"ai-fighter-foot-evidence")
        try:
            atomic_write_set({output:json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+"\n"})
        finally:
            release_run_dir_lock(output.parent)
        print(json.dumps({"out":str(output),"stride_verified":result.get("stride_verified"),"command":args.command}))
        return 0
    except (ValueError,OSError,TypeError,KeyError) as error:
        print(str(error),file=sys.stderr); return 2


if __name__ == "__main__":
    raise SystemExit(main())
