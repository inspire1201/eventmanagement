function toMySQLDateTime(isoString) {
  return new Date(isoString).toISOString().slice(0, 19).replace('T', ' ');
}

async function uploadToCloudinary(file, folder, cloudinary) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({
      folder,
      resource_type: file.mimetype.startsWith('video/') ? 'video' : 'image'
    }, (err, result) => {
      if (err) reject(err);
      else resolve(result.secure_url);
    }).end(file.buffer);
  });
}

module.exports = { toMySQLDateTime, uploadToCloudinary };
