# Secure Image Upload Implementation Guide

## Overview
The frontend code has been updated to remove direct Cloudinary API exposure. Image uploads now go through a secure backend endpoint that must validate:
- Admin authorization (via Firebase Auth token)
- File type and size (HTTPS only, max 5MB)
- Content security (malware scanning can be added)

## Implementation Options

### Option 1: Firebase Cloud Storage (Recommended - Easiest)

#### 1. Update Firebase Security Rules
```javascript
// firestore.rules
match /images/{allPaths=**} {
  // Only signed-in admins can upload
  allow read: if true;
  allow write: if request.auth != null 
    && exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
}
```

#### 2. Create Cloud Function for uploads
```bash
npm install -g firebase-tools
firebase init functions
cd functions
npm install
```

**functions/index.js:**
```javascript
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({origin: true});

admin.initializeApp();
const bucket = admin.storage().bucket();

exports.uploadImage = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      // Verify auth token
      if (!req.headers.authorization) {
        return res.status(401).json({error: "Unauthorized"});
      }

      const token = req.headers.authorization.split("Bearer ")[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // Verify admin status
      const adminDoc = await admin.firestore()
        .collection("admins")
        .doc(decodedToken.email)
        .get();
      
      if (!adminDoc.exists) {
        return res.status(403).json({error: "Not an admin"});
      }

      // Validate file from request body (base64 or buffer)
      if (!req.body.file) {
        return res.status(400).json({error: "No file provided"});
      }

      const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
      const MAX_SIZE = 5 * 1024 * 1024; // 5MB

      if (!ALLOWED_TYPES.includes(req.body.mimeType)) {
        return res.status(400).json({error: "Invalid file type"});
      }

      if (req.body.file.length > MAX_SIZE) {
        return res.status(400).json({error: "File too large"});
      }

      // Upload to Storage
      const fileName = `products/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const file = bucket.file(fileName);

      await file.save(Buffer.from(req.body.file, "base64"), {
        metadata: {
          contentType: req.body.mimeType,
          cacheControl: "public, max-age=31536000",
        },
      });

      // Get signed URL (valid for 1 year)
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
      });

      res.status(200).json({url});
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({error: error.message});
    }
  });
});
```

**Deploy:**
```bash
firebase deploy --only functions
```

#### 3. Update frontend to use Cloud Function

Update the `BACKEND_UPLOAD_ENDPOINT` in admin.html:
```javascript
const BACKEND_UPLOAD_ENDPOINT = 'https://YOUR_PROJECT.cloudfunctions.net/uploadImage';

// Update uploadToBackend to send base64
async function uploadToBackend(file, imageType = 'front') {
  // ... validation code ...

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64Data = e.target.result.split(',')[1];
    
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(BACKEND_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: base64Data,
        mimeType: file.type,
        imageType: imageType,
      }),
    });
    
    // ... handle response ...
  };
  reader.readAsDataURL(file);
}
```

---

### Option 2: Firebase Cloud Run (More Control)

1. Create a Docker container with Node.js/Express
2. Deploy to Cloud Run
3. Use similar validation logic as the Cloud Function

---

### Option 3: Traditional Backend (Node.js/Express)

**server.js:**
```javascript
const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;

admin.initializeApp();
const app = express();
const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'), false);
    }
    cb(null, true);
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    // Verify Firebase auth token
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({error: "Unauthorized"});

    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Check admin status
    const adminDoc = await admin.firestore()
      .collection('admins')
      .doc(decodedToken.email)
      .get();
    
    if (!adminDoc.exists) {
      return res.status(403).json({error: "Not an admin"});
    }

    // Upload to Cloudinary (API key only on server!)
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const result = await cloudinary.uploader.upload_stream(
      {folder: 'vestique'},
      (error, result) => {
        if (error) throw error;
        res.json({url: result.secure_url});
      }
    );

    result.end(req.file.buffer);
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

app.listen(3000);
```

---

## Environment Variables Required

Create `.env` in your project root:
```
# For Cloud Functions
FIREBASE_PROJECT_ID=vestique-d6b6f
FIREBASE_API_KEY=...

# For traditional backend
CLOUDINARY_CLOUD_NAME=ddsayzie0
CLOUDINARY_API_KEY=<KEEP_SECRET>
CLOUDINARY_API_SECRET=<KEEP_SECRET>
```

**Never commit `.env` to git!** Add to `.gitignore`:
```
.env
.env.local
node_modules/
```

---

## Frontend Update

Update `.env.local` in your project:
```
VITE_BACKEND_UPLOAD_ENDPOINT=https://your-backend-url/api/upload
VITE_MAX_IMAGE_SIZE_MB=5
```

---

## Security Checklist

- ✅ API keys are **server-side only**
- ✅ File type validated on both client and server
- ✅ File size limited (5MB max)
- ✅ Admin authorization verified via Firebase Auth
- ✅ HTTPS-only URLs returned
- ✅ Content-Security-Policy headers set
- ✅ Input validation on all form fields

---

## Testing

```bash
# Test the endpoint locally
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@image.jpg"
```

---

## References
- [Firebase Cloud Functions](https://firebase.google.com/docs/functions)
- [Firebase Cloud Storage Security Rules](https://firebase.google.com/docs/storage/security)
- [OWASP File Upload Best Practices](https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload)
