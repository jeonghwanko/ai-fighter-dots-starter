"""Real inspector regressions; synthetic shapes are measurement fixtures only."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from PIL import Image, ImageDraw
from sprite_gen.qa.motion import analyze_motion

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('contact_evidence',ROOT/'tools/ai-fighter/contact_evidence.py')
contact=importlib.util.module_from_spec(spec);spec.loader.exec_module(contact)
BOX=[38,54,46,31]

def draw_boot(draw,x,y=55,depth=3):
    draw.rectangle((x-10,y,x+15,y+28-depth),fill='white')
    draw.rectangle((x-10,y,x-4,y+28),fill='white')
    draw.rectangle((x+2,y,x+15,y+28),fill='white')

def make(xs=(66,58,50),ys=(55,55,55),depth=3):
    frames=[]
    for i,(x,y) in enumerate(zip(xs,ys)):
        im=Image.new('RGBA',(128,96));d=ImageDraw.Draw(im)
        d.rectangle((48,12,70,35),fill=(50+i,80,100,255))
        d.rectangle((15,40,32,50),fill='blue')
        draw_boot(d,x,y,depth);frames.append(im)
    seq=SimpleNamespace(frames=tuple(frames),durations=tuple([.1]*len(frames)),anchor=(64.,96.),source_files=(),metadata={},fingerprints=lambda:{})
    return seq

def record(i,x,y=55,foot='near'):
    boot=[[x-11,y-1],[x+16,y-1],[x+16,y+29],[x-11,y+29]]
    other=[[14,39],[33,39],[33,51],[14,51]]
    return {'frame':i,'nearOutline':boot if foot=='near' else other,
            'farOutline':other if foot=='near' else boot,'heel':[x-7,y+28],'forefoot':[x+9,y+28]}

def evidence(seq,xs=(66,58,50),ys=(55,55,55),box=BOX,version=1,frame=None):
    e=contact.template(seq,'near',0,2,box,'right',version)
    e['review']={'reviewer':'synthetic fixture author','method':'visual-per-frame',
                 'notes':'Known-coordinate test fixture; never represents a publishable character.',
                 **{key:'pass' for key in contact.REVIEW_KEYS}}
    e['frames']=[(frame or record)(i,x,y) for i,(x,y) in enumerate(zip(xs,ys))]
    return e

# A right-facing padded paw on ground row 84: three toe pads under the front of the sole,
# the heel corner lifted by `lift`. Its toe tip is x; the leg above leaves the ROI.
PAW_BOX=[20,50,62,35]
def draw_paw(draw,x,lift=0,y=84,pads=((-12,-10),(-7,-5),(-2,0))):
    draw.rectangle((x-20,40,x-12,62),fill='white')
    draw.polygon([(x-26,62),(x-6,62),(x,y-4),(x,y-2),(x-12,y-2),(x-26,y-2-lift)],fill='white')
    for a,b in pads:draw.rectangle((x+a,y-1,x+b,y),fill='white')

def make_paw(xs=(66,58,50),lifts=(0,4,8),ys=(84,84,84),**kw):
    frames=[]
    for i,(x,lift,y) in enumerate(zip(xs,lifts,ys)):
        im=Image.new('RGBA',(128,96));d=ImageDraw.Draw(im)
        d.rectangle((48,12,70,35),fill=(50+i,80,100,255))
        d.rectangle((2,30,14,44),fill='blue')
        draw_paw(d,x,lift,y,**kw);frames.append(im)
    return SimpleNamespace(frames=tuple(frames),durations=tuple([.1]*len(frames)),anchor=(64.,96.),source_files=(),metadata={},fingerprints=lambda:{})

def paw_record(lifts=(0,4,8),ys=(84,84,84)):
    def entry(i,x,_):
        paw=[[x-27,50],[x+1,50],[x+1,ys[i]],[x-27,ys[i]]]
        other=[[1,29],[15,29],[15,45],[1,45]]
        return {'frame':i,'nearOutline':paw,'farOutline':other,'heel':[x-25,ys[i]-3-lifts[i]],'forefoot':[x-1,ys[i]]}
    return entry

def paw_evidence(seq,xs=(66,58,50),lifts=(0,4,8),ys=(84,84,84),box=PAW_BOX):
    return evidence(seq,xs=xs,box=box,version=2,frame=paw_record(lifts,ys))

def run(seq,e,box=BOX):
    return contact.inspect(seq,'near',0,2,box,'right',e)

class ContactTests(unittest.TestCase):
    def test_boot_requires_explicit_evidence_and_retains_upstream(self):
        seq=make();before=[im.tobytes() for im in seq.frames]
        self.assertFalse(analyze_motion(seq,contacts='0:2',foot_box=BOX)['stride_verified'])
        out=run(seq,evidence(seq))
        self.assertTrue(out['stride_verified'],out['contact_candidates'][0]['reasons'])
        self.assertEqual(out['foot_velocity_px_per_second'],-80)
        self.assertFalse(out['upstream_report']['stride_verified'])
        self.assertEqual(out['upstream_report']['contact_candidates'][0]['reasons'],[contact.LOBE_REASON])
        self.assertEqual(before,[im.tobytes() for im in seq.frames])

    def test_blank_template_and_missing_evidence_fail(self):
        seq=make()
        self.assertFalse(run(seq,None)['stride_verified'])
        self.assertFalse(run(seq,contact.template(seq,'near',0,2,BOX,'right'))['stride_verified'])

    def test_both_disconnected_and_connected_two_feet_fail_with_labels(self):
        for connected in [False,True]:
            with self.subTest(connected=connected):
                seq=make();box=[10,30,75,56]
                for im in seq.frames:
                    d=ImageDraw.Draw(im)
                    d.rectangle((15,40,32,50),fill=(0,0,0,0))
                    draw_boot(d,23,55)
                    if connected:d.rectangle((13,55,81,57),fill='white')
                e=evidence(seq,box=box)
                for f in e['frames']:f['farOutline']=[[12,54],[39,54],[39,84],[12,84]]
                out=run(seq,e,box)
                self.assertFalse(out['stride_verified'])
                self.assertTrue(any('OTHER_FOOT_IN_ROI' in reason for reason in out['foot_evidence']['issues']))

    def test_roi_cannot_cut_off_sole_to_hide_lobes(self):
        seq=make();box=[38,54,46,25];e=evidence(seq,box=box)
        out=run(seq,e,box)
        self.assertFalse(out['stride_verified'])
        self.assertTrue(any('CLIPPED_BY_ROI' in x for x in out['foot_evidence']['issues']))

    def test_unlabelled_foreground_is_not_ignored(self):
        seq=make()
        for im in seq.frames:ImageDraw.Draw(im).rectangle((39,54,40,57),fill='white')
        out=run(seq,evidence(seq))
        self.assertFalse(out['stride_verified'])
        self.assertTrue(any('UNASSIGNED' in x for x in out['foot_evidence']['issues']))

    def test_changed_pixels_and_timing_invalidate_evidence(self):
        seq=make();e=evidence(seq)
        seq.frames[0].putpixel((0,0),(1,0,0,0))
        self.assertFalse(run(seq,e)['stride_verified'])
        seq=make();e=evidence(seq);seq.durations=(.1,.2,.1)
        self.assertFalse(run(seq,e)['stride_verified'])

    def test_other_foot_identity_and_stance_cannot_be_reused(self):
        seq=make();e=evidence(seq);e['stance']['foot']='far'
        self.assertIn('EVIDENCE_STANCE_MISMATCH',run(seq,e)['foot_evidence']['issues'])
        e=evidence(seq);e['stance']['box'][0]-=1
        self.assertFalse(run(seq,e)['stride_verified'])

    def test_incomplete_or_duplicate_frame_evidence_fails(self):
        seq=make()
        for change in ['missing','duplicate']:
            e=evidence(seq)
            if change=='missing':e['frames'].pop()
            else:e['frames'][1]['frame']=0
            self.assertFalse(run(seq,e)['stride_verified'])

    def test_landmarks_must_be_pixels_on_different_contact_lobes(self):
        seq=make()
        for name,point in [('heel',[50,55]),('heel',[60,81]),('forefoot',[59,83])]:
            e=evidence(seq);e['frames'][0][name]=point
            self.assertFalse(run(seq,e)['stride_verified'])

    def test_deep_gap_remains_ambiguous(self):
        seq=make(depth=10);out=run(seq,evidence(seq))
        self.assertFalse(out['stride_verified'])
        self.assertTrue(any('SHALLOW_SOLE_ARCH' in x for x in out['foot_evidence']['issues']))

    def test_three_contact_lobes_fail(self):
        seq=make()
        for x,im in zip((66,58,50),seq.frames):ImageDraw.Draw(im).rectangle((x-1,81,x,83),fill='white')
        self.assertFalse(run(seq,evidence(seq))['stride_verified'])

    def test_airborne_motion_cannot_be_resolved_by_contact_evidence(self):
        ys=(55,53,55);seq=make(ys=ys);box=[38,50,46,35]
        out=run(seq,evidence(seq,ys=ys,box=box),box)
        self.assertFalse(out['stride_verified'])
        self.assertTrue(any('vertically' in r for r in out['contact_candidates'][0]['reasons']))

    def test_nonuniform_velocity_still_fails(self):
        xs=(66,65,50);seq=make(xs=xs)
        out=run(seq,evidence(seq,xs=xs))
        self.assertFalse(out['stride_verified'])
        self.assertIn('foot velocity is inconsistent across the declared stance',out['contact_candidates'][0]['reasons'])

    def test_roi_boundary_and_review_uncertainty_still_fail(self):
        seq=make();box=[40,54,42,31]
        self.assertFalse(run(seq,evidence(seq,box=box),box)['stride_verified'])
        e=evidence(seq);e['review']['groundContact']='unverified'
        self.assertFalse(run(seq,e)['stride_verified'])

    def test_self_crossing_outline_is_invalid(self):
        seq=make();e=evidence(seq)
        e['frames'][0]['nearOutline']=[[55,54],[82,84],[82,54],[55,84]]
        self.assertFalse(run(seq,e)['stride_verified'])


class PaddedFootV2Tests(unittest.TestCase):
    """v2: lobes of one outlined foot and a lifted heel; real stance errors still fail."""
    def run2(self,seq,e,box=PAW_BOX):
        return contact.inspect(seq,'near',0,2,box,'right',e)

    def test_padded_paw_with_lifting_heel_verifies_at_the_planted_toe(self):
        seq=make_paw();before=[im.tobytes() for im in seq.frames]
        upstream=analyze_motion(seq,contacts='0:2',foot_box=PAW_BOX)
        self.assertFalse(upstream['stride_verified'])
        self.assertIn(contact.LOBE_REASON,upstream['contact_candidates'][0]['reasons'])
        out=self.run2(seq,paw_evidence(seq))
        self.assertTrue(out['stride_verified'],out['contact_candidates'][0]['reasons'])
        self.assertEqual(out['measurement_engine'],'ai-fighter-foot-evidence-v2')
        self.assertEqual(out['foot_velocity_px_per_second'],-80)
        obs=out['foot_evidence']['observations']
        self.assertEqual([o['lobeCount'] for o in obs],[3,3,3])
        # The pads carry the contact; the heel above them is lifted and is not required on the band.
        self.assertEqual([o['heelLifted'] for o in obs],[True,True,True])
        self.assertEqual([o['leadingContactX'] for o in obs],[66,58,50])
        self.assertIn(contact.LOBE_REASON,out['foot_evidence']['resolvedReasons'])
        self.assertEqual(before,[im.tobytes() for im in seq.frames])

    def test_v1_evidence_keeps_the_boot_only_rule(self):
        seq=make_paw();e=paw_evidence(seq);e['version']=1
        out=self.run2(seq,e)
        self.assertFalse(out['stride_verified'])
        self.assertEqual(out['measurement_engine'],'ai-fighter-foot-evidence-v1')

    def test_boot_fixture_gives_the_same_speed_under_v2(self):
        seq=make();out=run(seq,evidence(seq,version=2))
        self.assertTrue(out['stride_verified'],out['contact_candidates'][0]['reasons'])
        self.assertEqual(out['foot_velocity_px_per_second'],run(seq,evidence(seq))['foot_velocity_px_per_second'])

    def test_sliding_reversing_or_stationary_toe_fails(self):
        for xs,reason in [((66,65,50),'velocity is inconsistent'),((66,50,58),'horizontal reversal'),((66,66,66),'insufficient net')]:
            with self.subTest(xs=xs):
                seq=make_paw(xs=xs);out=self.run2(seq,paw_evidence(seq,xs=xs))
                self.assertFalse(out['stride_verified'])
                self.assertTrue(any(reason in r for r in out['contact_candidates'][0]['reasons']),out['contact_candidates'][0]['reasons'])

    def test_airborne_paw_is_never_resolved(self):
        ys=(84,82,84);seq=make_paw(ys=ys);out=self.run2(seq,paw_evidence(seq,ys=ys))
        self.assertFalse(out['stride_verified'])
        self.assertIn('foot baseline moves vertically; contact may be airborne',out['contact_candidates'][0]['reasons'])

    def test_forefoot_off_the_ground_fails(self):
        seq=make_paw();e=paw_evidence(seq);e['frames'][1]['forefoot'][1]-=4
        out=self.run2(seq,e)
        self.assertFalse(out['stride_verified'])
        self.assertTrue(any('FOREFOOT_MUST_TOUCH' in x for x in out['foot_evidence']['issues']))

    def test_heel_must_be_on_the_tracked_foot_and_behind(self):
        for point in ([10,45],[65,83]):
            with self.subTest(point=point):
                seq=make_paw();e=paw_evidence(seq);e['frames'][0]['heel']=point
                self.assertFalse(self.run2(seq,e)['stride_verified'])

    def test_deep_gap_between_contacts_is_still_ambiguous(self):
        seq=make(depth=10);out=run(seq,evidence(seq,version=2))
        self.assertFalse(out['stride_verified'])
        self.assertTrue(any('SHALLOW_SOLE_ARCH' in x for x in out['foot_evidence']['issues']))

    def test_wide_gap_between_pads_is_still_ambiguous(self):
        pads=((-25,-23),(-2,0));seq=make_paw(lifts=(0,0,0),pads=pads)
        out=self.run2(seq,paw_evidence(seq,lifts=(0,0,0)))
        self.assertFalse(out['stride_verified'])
        self.assertTrue(any('SHALLOW_SOLE_ARCH' in x for x in out['foot_evidence']['issues']))

    def test_other_foot_in_roi_and_roi_boundary_still_fail(self):
        seq=make_paw()
        for im in seq.frames:ImageDraw.Draw(im).rectangle((2,30,22,84),fill='blue')
        e=paw_evidence(seq)
        for f in e['frames']:f['farOutline']=[[1,29],[23,29],[23,84],[1,84]]
        out=self.run2(seq,e)
        self.assertFalse(out['stride_verified'])
        self.assertTrue(any('OTHER_FOOT_IN_ROI' in x for x in out['foot_evidence']['issues']))
        seq=make_paw();box=[20,50,40,35]
        self.assertFalse(self.run2(seq,paw_evidence(seq,box=box),box)['stride_verified'])

    def test_stale_or_unreviewed_v2_evidence_fails(self):
        seq=make_paw();e=paw_evidence(seq);seq.frames[2].putpixel((0,0),(1,0,0,0))
        self.assertFalse(self.run2(seq,e)['stride_verified'])
        seq=make_paw();e=paw_evidence(seq);e['review']['completeFoot']='unverified'
        self.assertFalse(self.run2(seq,e)['stride_verified'])


def write_fixture(folder,version=1):
    folder.mkdir(parents=True,exist_ok=True)
    frames=[]
    for i in range(16):
        x=74-8*(i%8);im=make((x,),(55,)).frames[0]
        im.putpixel((50,15),(i+10,80,100,255));im.save(folder/f'{i}.png');frames.append(im)
    from sprite_gen.spec.assets import load_asset
    descriptor={'kind':'sprite-gen-asset','version':1,'frames':[{'file':f'{i}.png','duration':.1} for i in range(16)]}
    (folder/'sequence.json').write_text(json.dumps(descriptor),encoding='utf-8')
    seq=load_asset(folder/'sequence.json')
    for foot,start in [('near',1),('far',9)]:
        e=contact.template(seq,foot,start,start+2,BOX,'right',version)
        e['review']=evidence(make())['review']
        e['frames']=[record(i,74-8*(i%8),foot=foot) for i in range(start,start+3)]
        (folder/f'{foot}.json').write_text(json.dumps(e),encoding='utf-8')

if __name__=='__main__':
    if len(sys.argv) in (3,4) and sys.argv[1]=='--fixture-dir':write_fixture(Path(sys.argv[2]),int(sys.argv[3]) if len(sys.argv)==4 else 1)
    else:unittest.main()
