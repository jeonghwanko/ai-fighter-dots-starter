"""Offline regression tests against the actual patched engine; no provider calls."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw
from sprite_gen.frames import extract
from sprite_gen.gen import gen_set, prepare
from sprite_gen.gen.motion_contract import motion_refs, normalize_motion, prompt_text


class MotionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gpt-motion-')
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.ref = self.root / 'phases.png'
        Image.new('RGB', (64, 64), 'orange').save(self.ref)
        self.motion = {'kind': 'walk', 'stage': 'keyposes',
                       'phases': [{'pose': 'near support', 'support': ['near']}, {'pose': 'far support', 'support': ['far']}],
                       'references': [{'role': 'phase-guide', 'file': str(self.ref), 'sha256': hashlib.sha256(self.ref.read_bytes()).hexdigest()}]}

    def row(self):
        strip = Image.new('RGBA', (240, 80))
        for i, bottom in enumerate([70, 58, 70]):
            ImageDraw.Draw(strip).rectangle((i * 80 + 25, bottom - 32, i * 80 + 44, bottom - 1), fill=(150 + i, 80, 30, 255))
        return strip

    def test_component_and_slot_paths_preserve_flight_before_crop(self):
        for route in (extract.extract_component_frames, extract.extract_slot_frames):
            with self.subTest(route=route.__name__):
                frames = route(self.row(), 3, 80, 80, 10, 10, {'ground_frames': False, 'resample': 'nearest'})
                self.assertEqual([frame.getbbox()[3] for frame in frames], [70, 58, 70])
                self.assertEqual([frame.getbbox()[3]-frame.getbbox()[1] for frame in frames], [32]*3)

    def test_default_grounding_is_unchanged(self):
        frames = extract.extract_component_frames(self.row(), 3, 80, 80, 10, 10, {})
        self.assertEqual([frame.getbbox()[3] for frame in frames], [70]*3)

    def test_one_scale_preserves_offsets_when_shrinking(self):
        frames = extract.extract_component_frames(self.row(), 3, 40, 40, 5, 5, {'ground_frames': False, 'resample': 'nearest'})
        bottoms = [frame.getbbox()[3] for frame in frames]
        self.assertEqual(bottoms[0], bottoms[2])
        self.assertGreater(bottoms[0] - bottoms[1], 5)
        self.assertEqual(len({frame.getbbox()[3]-frame.getbbox()[1] for frame in frames}), 1)

    def test_invalid_ground_never_silently_clips(self):
        with self.assertRaises(SystemExit):
            extract.extract_component_frames(self.row(), 3, 80, 80, 10, 10, {'ground_frames': False, 'source_ground_y': 30})

    def test_explicit_ground_preserves_an_all_airborne_row(self):
        images = [self.row().crop((i*80,0,(i+1)*80,80)) for i in range(3)]
        result = extract.fit_row_to_cells(images,80,80,10,10,{'ground_frames':False,'source_ground_y':76,'resample':'nearest'})
        self.assertEqual([image.getbbox()[3] for image in result],[64,52,64])

    def test_prepare_retains_motion_and_embeds_all_phases(self):
        states = prepare.normalize_states({'walk': {'frames': 2, 'action': 'walk', 'motion': self.motion}})
        self.assertEqual(states['walk']['motion'], self.motion)
        self.assertIn('Frame 1: far support', prompt_text(states['walk']['motion']))
        self.assertFalse(any('motion' in note for note in prepare.dropped_key_notes({'states': states})))

    def test_invalid_phase_count_and_same_foot_cycle_rejected(self):
        for phases in ([self.motion['phases'][0]], [self.motion['phases'][0]]*2):
            value = dict(self.motion, phases=phases)
            with self.assertRaises(SystemExit): normalize_motion(value, 2)

    def test_run_requires_flight(self):
        with self.assertRaises(SystemExit): normalize_motion(dict(self.motion, kind='run'), 2)

    def test_full_sequence_requires_actual_keypose_review(self):
        with self.assertRaisesRegex(SystemExit, 'MOTION_KEYPOSE_REVIEW_REQUIRED'):
            motion_refs(self.root, dict(self.motion, stage='sequence'), 2)

    def test_changed_guide_is_rejected(self):
        self.ref.write_bytes(b'changed')
        with self.assertRaisesRegex(SystemExit, 'missing or changed'): motion_refs(self.root, self.motion, 2)

    def prepared(self):
        run = self.root / 'run'
        prepare.run(out_dir=run, character_id='test', base_image=self.ref,
                    request_json=json.dumps({'states':{'walk':{'frames':2,'motion':self.motion}}}))
        return run, json.loads((run/'sprite-request.json').read_text())

    def test_refs_reach_provider_and_cache_is_bound_to_prompt(self):
        run, request = self.prepared()
        calls=[]
        def fake(prompt, out, refs, report, **kwargs):
            calls.append(refs)
            Image.new('RGB',(128,64),'orange').save(out)
            report.write_text(json.dumps({'provider':'codex'}))
            return 0
        args=dict(run_dir=run,request=request,state='walk',provider='codex',model=None,force=False,gen_runner=fake)
        first=gen_set.run_item(**args)
        self.assertTrue(first['ok'], first)
        self.assertEqual(len(calls[0]),3)
        self.assertEqual(calls[0][1],self.ref)
        self.assertEqual(first['motion_quality'],'unverified')
        second=gen_set.run_item(**args)
        self.assertTrue(second['reused'])
        prompt=run/prepare.prompt_rel(request,'walk')
        prompt.write_text(prompt.read_text(encoding='utf-8')+'\nchanged',encoding='utf-8')
        third=gen_set.run_item(**args)
        self.assertFalse(third['ok'])
        self.assertEqual(len(calls),1)

    def test_unknown_outcome_preserves_output_and_blocks_retry(self):
        run, request=self.prepared()
        calls=[]
        def incomplete(prompt,out,refs,report,**kwargs):
            calls.append(1)
            Image.new('RGB',(128,64),'orange').save(out)
            return 1
        args=dict(run_dir=run,request=request,state='walk',provider='codex',model=None,force=False,gen_runner=incomplete)
        first=gen_set.run_item(**args)
        self.assertFalse(first['ok'])
        self.assertTrue(Path(first['out']).exists())
        self.assertFalse(gen_set.run_item(**args)['ok'])
        self.assertEqual(len(calls),1)

    def test_accepted_keyposes_are_hash_bound_and_sent(self):
        key=self.root/'keys.png'
        Image.new('RGB',(128,64),'blue').save(key)
        value=copy.deepcopy(self.motion)
        value['stage']='sequence'
        value['references'].append({'role':'keyposes','file':str(key),'sha256':hashlib.sha256(key.read_bytes()).hexdigest(),
            'review':{**{name:'pass' for name in ('identity','anatomy','alternation','contacts','bodyContinuity')},'notes':'Synthetic reference plumbing test, not a character approval.'}})
        self.assertEqual(motion_refs(self.root,value,2),[self.ref,key])
        value['references'][-1]['review']['contacts']='unverified'
        with self.assertRaises(SystemExit): motion_refs(self.root,value,2)


if __name__=='__main__': unittest.main()
