require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const multer = require('multer'); // 1. IMPORT MULTER
const path = require('path');     // 2. IMPORT PATH

const app = express();
const PORT = process.env.PORT || 5000;

// --- 3. MIDDLEWARE ---
app.use(express.json()); 
app.use(cors());
// Serve the 'uploads' folder statically so frontend can access images
app.use('/uploads', express.static('uploads')); 

// --- 4. MULTER STORAGE CONFIG (For Image Uploads) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Images will be saved in 'uploads' folder
  },
  filename: function (req, file, cb) {
    // Save as: profile-TIMESTAMP.jpg
    cb(null, 'profile-' + Date.now() + path.extname(file.originalname)); 
  }
});
const upload = multer({ storage: storage });

// --- 5. CONNECT TO MONGODB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- 6. SECURITY MIDDLEWARE ---
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ message: "Access Denied: No Token" });

  try {
    const cleanToken = token.startsWith("Bearer ") ? token.slice(7, token.length) : token;
    const verified = jwt.verify(cleanToken, process.env.JWT_SECRET);
    req.user = verified; 
    next();
  } catch (err) {
    res.status(400).json({ message: "Invalid Token" });
  }
};

// --- 7. DATABASE SCHEMA (UPDATED) ---
const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  
  // --- NEW FIELDS ---
  phone:      { type: String, default: "" },
  address:    { type: String, default: "" },
  gender:     { type: String, default: "" },
  dob:        { type: String, default: "" },
  profileImg: { type: String, default: "" }, // Stores the URL/path to image
  
  // Storage for saved pages
  savedData: [
    {
      title: String,
      informationType: String, 
      content: Object, 
      savedAt: { type: Date, default: Date.now }
    }
  ]
});

const User = mongoose.model('User', UserSchema);

// --- 8. ROUTES ---

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already in use." });

    const newUser = new User({ fullName, email, password });
    await newUser.save();

    console.log("📝 New User Registered:", email);
    res.status(201).json({ message: "Account created! Please log in." });
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.json({ 
      token, 
      user: { id: user._id, name: user.fullName, email: user.email } 
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// GET USER PROFILE (UPDATED)
app.get('/api/user-profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password'); 
    if (!user) return res.status(404).json({ message: "User not found" });

    // Return fields including profileImg
    res.json({ 
      id: user._id, 
      name: user.fullName, 
      email: user.email,
      phone: user.phone,
      address: user.address,
      gender: user.gender,
      dob: user.dob,
      profileImg: user.profileImg // Send image path to frontend
    });
  } catch (err) {
    console.error("Profile Fetch Error:", err);
    res.status(500).json({ message: "Server Error fetching profile" });
  }
});

// UPDATE PROFILE (UPDATED FOR IMAGE UPLOAD)
// 'upload.single' processes the incoming file
app.put('/api/update-profile', verifyToken, upload.single('profileImage'), async (req, res) => {
  try {
    // If a file is uploaded, req.file will exist.
    // Text fields are in req.body
    const { fullName, email, phone, address, gender, dob } = req.body;
    const userId = req.user.id;

    // Build the update object dynamically
    const updateData = {
      fullName, 
      email, 
      phone, 
      address, 
      gender, 
      dob
    };

    // Only update profileImg if a new file was actually uploaded
    if (req.file) {
      updateData.profileImg = `/uploads/${req.file.filename}`;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true } 
    ).select('-password'); 

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    res.json({ 
      message: "Profile updated successfully!", 
      user: updatedUser
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating profile", error: err.message });
  }
});

// SAVE PAGE
app.post('/api/save-page', verifyToken, async (req, res) => {
  try {
    const { title, pageData, informationType } = req.body;
    const userId = req.user.id;

    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      {
        $push: { 
          savedData: { 
            title: title || "Untitled Save", 
            informationType: informationType || "General", 
            content: pageData 
          } 
        }
      },
      { new: true } 
    );

    if (!updatedUser) return res.status(404).json({ message: "User not found." });
    res.json({ message: "Page saved successfully!" });

  } catch (err) {
    res.status(500).json({ message: "Error saving page" });
  }
});

// GET SAVED PAGES
app.get('/api/my-saved-pages', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    
    const sortedData = user.savedData.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    res.json(sortedData);
  } catch (err) {
    res.status(500).json({ message: "Error fetching data" });
  }
});

// DELETE PAGE
app.delete('/api/my-saved-pages/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const itemId = req.params.id;

    await User.findByIdAndUpdate(userId, { $pull: { savedData: { _id: itemId } } });
    res.json({ message: "Item deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error deleting item" });
  }
});

// --- 9. START SERVER ---
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));