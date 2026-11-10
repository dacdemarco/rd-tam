"""Opt-in integration check using an existing local model and speech fixture."""
from pathlib import Path
import json
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from rd_tam.engine import QueueManager, model_available


def main():
    assert model_available(ROOT / 'data/models/tiny'), 'Download tiny first'
    manager = QueueManager(ROOT / 'data')
    began = time.monotonic()
    seen = []
    try:
        jobs = manager.add_files([ROOT / 'tests/fixtures/media/voice.wav', ROOT / 'tests/fixtures/media/voice.mp4'], model='tiny', language='en')
        paused = False
        previous = None
        while time.monotonic() - began < 240:
            state = manager.tick()
            key = [(j['status'], j['stage'], len(j['segments'])) for j in state['jobs']]
            if key != previous:
                print(key, flush=True)
                previous = key
            active = [j for j in state['jobs'] if j['status'] in ('processing', 'paused')]
            assert len(active) <= 1
            if active and not paused:
                manager.pause(active[0]['id'])
                assert manager.snapshot()['jobs'][0]['status'] == 'paused'
                time.sleep(.2)
                manager.resume(active[0]['id'])
                paused = True
            if all(j['status'] in ('completed', 'error', 'cancelled') for j in state['jobs']):
                break
            time.sleep(.08)
        for job in manager.snapshot()['jobs']:
            assert job['status'] == 'completed', job
            text = ' '.join(s['text'] for s in job['segments'])
            assert 'forest' in text.lower() or 'transcription' in text.lower(), text
            files = manager.export(job['id'], ROOT / 'qa/exports', ('txt', 'srt'))
            assert '-->' in Path(files[1]).read_text(encoding='utf-8-sig')
            seen.append({'name':job['name'],'text':text,'segments':len(job['segments']),'progress':job['progress']})
        (ROOT / 'qa/transcription-result.json').write_text(json.dumps({'ok':True,'jobs':seen,'pause_resume':paused}, indent=2), encoding='utf-8')
        print(json.dumps(seen, indent=2))
    finally:
        manager.close()


if __name__ == '__main__':
    main()
