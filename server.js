const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5000';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const multer = require('multer'); // Handles Image Uploads
const path = require('path');     // Handles File Paths

const app = express();
const PORT = process.env.PORT || 5000;

// --- MIDDLEWARE ---
app.use(express.json()); 
app.use(cors());
// Serve the 'uploads' folder statically so frontend can display images
app.use('/uploads', express.static('uploads')); 

// --- MULTER STORAGE CONFIG ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); 
  },
  filename: function (req, file, cb) {
    cb(null, 'profile-' + Date.now() + path.extname(file.originalname)); 
  }
});
const upload = multer({ storage: storage });

// --- MONGODB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- SECURITY MIDDLEWARE (Verify Token) ---
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

// --- DATABASE SCHEMA ---
const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  
  // Profile Fields
  phone:      { type: String, default: "" },
  address:    { type: String, default: "" },
  gender:     { type: String, default: "" },
  dob:        { type: String, default: "" },
  profileImg: { type: String, default: "" }, 

  // --- ADDED MEDICAL FIELDS ---
  bloodType:  { type: String, default: "" },
  height:     { type: String, default: "" },
  weight:     { type: String, default: "" },
  allergies:  { type: String, default: "" },
  conditions: { type: String, default: "" },
  // -----------------------------
  
  // 1. Saved Medical Records (Existing)
  savedData: [
    {
      title: String,
      informationType: String, 
      content: Object, 
      savedAt: { type: Date, default: Date.now }
    }
  ],

  // 2. NEW: News History
  newsHistory: [
    {
      title: String,
      source: String,
      date: String,
      url: String,
      addedAt: { type: Date, default: Date.now }
    }
  ],

  // 3. NEW: Appointment History
  appointmentHistory: [
    {
      doctor: String,
      type: String, // e.g., "Cardiology", "General"
      date: String, // e.g., "2025-01-10"
      status: { type: String, default: "Upcoming" }, // Upcoming, Completed
      addedAt: { type: Date, default: Date.now }
    }
  ]
});

const User = mongoose.model('User', UserSchema);

// --- ROUTES ---

// 1. REGISTER
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

// 2. LOGIN
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

// 3. GET USER PROFILE
app.get('/api/user-profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password'); 
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ 
      id: user._id, 
      name: user.fullName, 
      fullName: user.fullName, // Added mainly for frontend logic
      email: user.email,
      phone: user.phone,
      address: user.address,
      gender: user.gender,
      dob: user.dob,
      profileImg: user.profileImg,
      // Return Medical Fields
      bloodType: user.bloodType,
      height: user.height,
      weight: user.weight,
      allergies: user.allergies,
      conditions: user.conditions
    });
  } catch (err) {
    console.error("Profile Fetch Error:", err);
    res.status(500).json({ message: "Server Error fetching profile" });
  }
});

// 4. UPDATE PROFILE (With Image Upload)
app.put('/api/update-profile', verifyToken, upload.single('profileImage'), async (req, res) => {
  try {
    // Destructure all fields including new medical ones
    const { 
      fullName, email, phone, address, gender, dob,
      bloodType, height, weight, allergies, conditions 
    } = req.body;
    
    const userId = req.user.id;

    // Create update object
    const updateData = { 
      fullName, email, phone, address, gender, dob,
      bloodType, height, weight, allergies, conditions 
    };

    if (req.file) {
      updateData.profileImg = `/uploads/${req.file.filename}`;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true } 
    ).select('-password'); 

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    res.json({ message: "Profile updated successfully!", user: updatedUser });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating profile", error: err.message });
  }
});

// 5. SAVE PAGE (Existing Medical History)
app.post('/api/save-page', verifyToken, async (req, res) => {
  try {
    const { title, pageData, informationType } = req.body;
    const userId = req.user.id;
    const urlToCheck = pageData.url; 

    const user = await User.findById(userId);
    const isDuplicate = user.savedData.some(item => item.content?.url === urlToCheck);

    if (isDuplicate) {
      return res.status(400).json({ message: "You have already saved this article." });
    }

    await User.findByIdAndUpdate(userId, {
        $push: { savedData: { title: title || "Untitled", informationType: informationType || "General", content: pageData } }
      }, { new: true } 
    );

    res.json({ message: "Page saved successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Error saving page" });
  }
});

// 6. GET SAVED PAGES (Medical History)
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

// 7. DELETE SAVED PAGE (Medical History)
app.delete('/api/my-saved-pages/:id', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { $pull: { savedData: { _id: req.params.id } } });
    res.json({ message: "Item deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error deleting item" });
  }
});

// --- NEW ROUTES FOR NEWS HISTORY ---

// 8. ADD NEWS
app.post('/api/news', verifyToken, async (req, res) => {
  try {
    const { title, source, date, url } = req.body;
    await User.findByIdAndUpdate(req.user.id, {
      $push: { newsHistory: { title, source, date, url } }
    });
    res.json({ message: "News saved successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Error saving news" });
  }
});

// 9. GET NEWS
app.get('/api/news', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user.newsHistory.reverse()); // Newest first
  } catch (err) {
    res.status(500).json({ message: "Error fetching news" });
  }
});

// 10. DELETE NEWS
app.delete('/api/news/:id', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { 
      $pull: { newsHistory: { _id: req.params.id } } 
    });
    res.json({ message: "News deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting news" });
  }
});

// --- NEW ROUTES FOR APPOINTMENT HISTORY ---

// 11. ADD APPOINTMENT
app.post('/api/appointments', verifyToken, async (req, res) => {
  try {
    const { doctor, type, date, status } = req.body;
    await User.findByIdAndUpdate(req.user.id, {
      $push: { appointmentHistory: { doctor, type, date, status } }
    });
    res.json({ message: "Appointment added!" });
  } catch (err) {
    res.status(500).json({ message: "Error adding appointment" });
  }
});

// 12. GET APPOINTMENTS
app.get('/api/appointments', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user.appointmentHistory.reverse()); 
  } catch (err) {
    res.status(500).json({ message: "Error fetching appointments" });
  }
});

// 13. DELETE APPOINTMENT
app.delete('/api/appointments/:id', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { 
      $pull: { appointmentHistory: { _id: req.params.id } } 
    });
    res.json({ message: "Appointment deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting appointment" });
  }
});

// --- START SERVER ---
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));