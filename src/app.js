const express = require('express');
const morgan = require('morgan');
const mustacheExpress = require('mustache-express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const filesizeModule = require('filesize');
const formatFileSize = typeof filesizeModule === 'function' ? filesizeModule : filesizeModule.filesize;

const port = Number(process.env.PORT || 7777);
const staticFilesPath = path.resolve(process.env.STATIC_FILES || './files');
const localIp = process.env.LOCALIP || 'localhost';

const app = express();
let currentPS4ipadr = process.env.PS4IP || 'localhost';

app.use(morgan('combined'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use('/css', express.static(path.join(__dirname, '../node_modules/@fortawesome/fontawesome-free/css')));
app.use('/webfonts', express.static(path.join(__dirname, '../node_modules/@fortawesome/fontawesome-free/webfonts')));
app.use('/css', express.static(path.join(__dirname, '../node_modules/bootstrap/dist/css')));
app.use('/js', express.static(path.join(__dirname, '../node_modules/bootstrap/dist/js')));
app.use('/css', express.static(path.join(__dirname, 'views/css')));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/pkgfiles', express.static(staticFilesPath, { dotfiles: 'deny', fallthrough: false }));

app.engine('html', mustacheExpress());
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res, next) => {
  try {
    const dirs = flattenPkgs(getPkgs());
    const totalPkgs = dirs.reduce((sum, dir) => sum + dir.count, 0);
    const totalBytes = dirs.reduce((sum, dir) => sum + dir.bytes, 0);

    res.render('index', {
      dirs,
      hasDirs: dirs.length > 0,
      totalDirs: dirs.length,
      totalPkgs,
      totalSize: formatFileSize(totalBytes)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/ps4ip', (req, res) => {
  res.json({ variable: currentPS4ipadr });
});

app.post('/api/ps4ip', (req, res) => {
  const newPS4ipadr = String(req.body.newPS4ipadr || '').trim();

  if (!isValidHost(newPS4ipadr)) {
    return res.status(400).json({ message: 'Invalid PS4 IP/host' });
  }

  currentPS4ipadr = newPS4ipadr;
  res.json({ message: 'PS4 IP address updated', variable: currentPS4ipadr });
});

app.post('/install', async (req, res) => {
  try {
    const filepath = resolvePkgPath(req.body.filepath);
    const result = await ps4Install(filepath);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Server error');
});

app.listen(port, () => {
  console.log(`PS4 PKG sender listening on port ${port} serving files from ${staticFilesPath}`);
});

function flattenPkgs(pkgs) {
  return Object.keys(pkgs)
    .sort((a, b) => a.localeCompare(b))
    .map((root) => {
      const rootPkgs = pkgs[root].sort((a, b) => a.name.localeCompare(b.name));
      const bytes = rootPkgs.reduce((sum, pkg) => sum + pkg.bytes, 0);
      const folderImgname = rootPkgs.length > 0 ? rootPkgs[0].imgname : 'folder.png';

      return {
        id: crypto.randomUUID(),
        root,
        count: rootPkgs.length,
        bytes,
        folderImgname,
        pkgs: rootPkgs
      };
    });
}

function getPkgs() {
  const filelist = {};

  if (!fs.existsSync(staticFilesPath)) {
    return filelist;
  }

  function walkSync(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });

    files.forEach((file) => {
      const filepath = path.join(dir, file.name);

      if (file.isDirectory()) {
        walkSync(filepath);
        return;
      }

      if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.pkg') {
        return;
      }

      const stat = fs.statSync(filepath);
      const relativePath = path.relative(staticFilesPath, filepath);
      const dirname = path.dirname(relativePath) === '.' ? 'Root' : path.dirname(relativePath);
      const root = dirname.split(path.sep)[0] || 'Root';
      const name = path.basename(filepath);

      if (!filelist[root]) filelist[root] = [];

      filelist[root].push({
        filepath,
        relativePath,
        dir: dirname,
        name,
        imgname: `${path.parse(filepath).name}.jpg`,
        size: formatFileSize(stat.size),
        bytes: stat.size,
        searchText: `${root} ${dirname} ${name}`.toLowerCase()
      });
    });
  }

  walkSync(staticFilesPath);
  return filelist;
}

function resolvePkgPath(filepath) {
  const requestedPath = path.resolve(String(filepath || ''));
  const relative = path.relative(staticFilesPath, requestedPath);

  if (!requestedPath || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid package path');
  }

  if (path.extname(requestedPath).toLowerCase() !== '.pkg' || !fs.existsSync(requestedPath)) {
    throw new Error('Package not found');
  }

  return requestedPath;
}

function encodeRelativeUrl(filepath) {
  return path.relative(staticFilesPath, filepath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');
}

function ps4Install(filepath) {
  return new Promise((resolve, reject) => {
    const pkgUri = `http://${localIp}:${port}/pkgfiles/${encodeRelativeUrl(filepath)}`;
    const ps4ApiUri = `http://${currentPS4ipadr}:12800/api/install`;
    const payload = JSON.stringify({ type: 'direct', packages: [pkgUri] });

    execFile('curl', ['-sS', '-v', ps4ApiUri, '--data', payload], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`Install request failed: ${stderr || err.message}`));
      }

      resolve({
        message: `Install request sent for ${path.basename(filepath)}`,
        package: path.basename(filepath),
        stdout,
        stderr
      });
    });
  });
}

function isValidHost(value) {
  if (!value || value.length > 253) return false;
  return /^(localhost|[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\]|[a-fA-F0-9:]+)$/.test(value);
}
