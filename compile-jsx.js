#!/usr/bin/env node
// Pre-compiles JSX from HTML files — removes need for @babel/standalone in browser
const fs = require('fs');
const babel = require('@babel/core');

const FILES = [
  'jia-course-web.html',
  'jia-sales.html',
  'jia-instructor.html',
  'jia-booking.html',
];

const BABEL_OPTS = {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  plugins: [],
};

const BABEL_CDN_RE = /[ \t]*<script[^>]+@babel\/standalone[^>]*><\/script>\n?/g;

for (const file of FILES) {
  const html = fs.readFileSync(file, 'utf8');

  // Find all <script type="text/babel"> blocks
  let result = html;
  let count = 0;
  result = result.replace(/<script type="text\/babel">([\s\S]*?)<\/script>/g, (_match, jsx) => {
    const compiled = babel.transformSync(jsx, BABEL_OPTS);
    count++;
    return `<script>${compiled.code}\n</script>`;
  });

  // Remove Babel standalone CDN
  result = result.replace(BABEL_CDN_RE, '');

  fs.writeFileSync(file, result);
  console.log(`✅ ${file} — ${count} block(s) compiled, Babel CDN removed`);
}
