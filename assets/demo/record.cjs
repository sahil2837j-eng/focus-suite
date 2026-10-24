/* Record the Focus Suite demo stages to GIF.
   Run: NODE_PATH=/path/to/playwright/node_modules node record.cjs
   Source screenshots live in ./shots and were captured from the real popup
   with a seeded local state. No network is used. */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HERE = __dirname;
const ASSETS = path.resolve(HERE, '..');
const FRAMES = path.join(os.tmpdir(), 'focus-demo-frames');
const FPS = 15;

const stories = [
  { key: 'showcase', seconds: 12, out: 'showcase.gif' },
  { key: 'proof', seconds: 10, out: 'proof.gif' },
];

function encode(framesDir, outFile) {
  const filter = [
    'split[s0][s1]',
    '[s0]palettegen=max_colors=192:stats_mode=diff[p]',
    '[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  ].join(';');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS),
    '-i', path.join(framesDir, 'f%04d.png'),
    '-vf', filter,
    '-loop', '0',
    outFile,
  ], { stdio: 'inherit' });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  for (const story of stories) {
    const framesDir = path.join(FRAMES, story.key);
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });

    await page.goto(`file://${path.join(HERE, 'story.html')}?story=${story.key}`, { waitUntil: 'load' });
    await page.evaluate(() => window.__ready);
    await page.waitForTimeout(250);

    const total = Math.round(story.seconds * FPS);
    for (let frame = 0; frame < total; frame++) {
      const t = frame / FPS;
      await page.evaluate((time) => window.renderAt(time), t);
      await page.screenshot({ path: path.join(framesDir, `f${String(frame).padStart(4, '0')}.png`) });
    }

    const outFile = path.join(ASSETS, story.out);
    encode(framesDir, outFile);
    const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
    console.log(`${story.out}: ${total} frames, ${size} MiB`);
  }

  if (errors.length) {
    console.error('Stage errors:\n' + errors.slice(0, 20).join('\n'));
    process.exitCode = 1;
  }
  await browser.close();
})();
