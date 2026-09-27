const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

const ALLOWED = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];

function makeStorage(subfolder) {
  const dest = path.join(__dirname, '..', '..', 'public', 'uploads', subfolder);
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}_${nanoid(8)}${ext}`);
    }
  });
}

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED.includes(ext)) {
    return cb(new Error('Only image files are allowed (png, jpg, jpeg, webp, svg, gif)'));
  }
  cb(null, true);
}

const limits = { fileSize: 8 * 1024 * 1024 }; // 8MB

const uploadProduct = multer({ storage: makeStorage('products'), fileFilter, limits });
const uploadDesign = multer({ storage: makeStorage('designs'), fileFilter, limits });
const uploadAvatar = multer({ storage: makeStorage('avatars'), fileFilter, limits });

module.exports = { uploadProduct, uploadDesign, uploadAvatar };
