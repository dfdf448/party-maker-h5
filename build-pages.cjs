const fs = require('fs');
const path = require('path');

const root = __dirname;
const output = path.join(root, 'pages-dist');
const copy = (source, target) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
};

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'assets', 'characters'), { recursive: true });
copy(path.join(root, 'index.html'), path.join(output, 'index.html'));
copy(path.join(root, 'styles.css'), path.join(output, 'styles.css'));
copy(path.join(root, 'game.js'), path.join(output, 'game.js'));

for (const file of fs.readdirSync(path.join(root, 'assets', 'characters'))) {
  if (file.endsWith('.png')) copy(
    path.join(root, 'assets', 'characters', file),
    path.join(output, 'assets', 'characters', file),
  );
}

console.log(`Built ${output}`);
