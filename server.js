const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const twilio = require("twilio");

/* -------------------------
TWILIO SETTINGS
------------------------- */

const ACCOUNT_SID = process.env.TWILIO_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH;
const TWILIO_PHONE = process.env.TWILIO_PHONE;

let client;

if (ACCOUNT_SID && AUTH_TOKEN) {
client = twilio(ACCOUNT_SID, AUTH_TOKEN);
}

/* -------------------------
SERVER SETUP
------------------------- */

app.use(express.static("public"));
app.use(express.json());

/* -------------------------
FILE STORAGE
------------------------- */

const storage = multer.diskStorage({
destination: function (req, file, cb) {
if (file.fieldname === "profile") {
cb(null, "profiles/");
} else {
cb(null, "uploads/");
}
},
filename: function (req, file, cb) {
cb(null, Date.now() + "-" + file.originalname);
}
});

const upload = multer({ storage });

app.use("/uploads", express.static("uploads"));
app.use("/profiles", express.static("profiles"));

/* -------------------------
DATABASE
------------------------- */

const db = new sqlite3.Database("chat.db");

db.run(`CREATE TABLE IF NOT EXISTS users(
id INTEGER PRIMARY KEY AUTOINCREMENT,
username TEXT UNIQUE,
password TEXT,
phone TEXT,
profilePic TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS messages(
id INTEGER PRIMARY KEY AUTOINCREMENT,
sender TEXT,
receiver TEXT,
message TEXT
)`);

/* -------------------------
OTP STORAGE
------------------------- */

let verificationCodes = {};

/* -------------------------
SEND SMS CODE
------------------------- */

app.post("/send-code", (req, res) => {

const { phone } = req.body;

if (!client) {
return res.json({ success: false });
}

let code = Math.floor(100000 + Math.random() * 900000);

verificationCodes[phone] = code;

client.messages.create({
body: "Your verification code is: " + code,
from: TWILIO_PHONE,
to: phone
}).then(() => {

res.json({ success: true });

}).catch(() => {

res.json({ success: false });

});

});

/* -------------------------
VERIFY CODE
------------------------- */

app.post("/verify-code", (req, res) => {

const { phone, code } = req.body;

if (verificationCodes[phone] == code) {
res.json({ success: true });
} else {
res.json({ success: false });
}

});

/* -------------------------
SIGNUP
------------------------- */

app.post("/signup", upload.single("profile"), (req, res) => {

const username = req.body.username;
const password = req.body.password;
const phone = req.body.phone;

let profilePic = "";

if (req.file) {
profilePic = req.file.filename;
}

db.run(
"INSERT INTO users(username,password,phone,profilePic) VALUES(?,?,?,?)",
[username, password, phone, profilePic],
function (err) {

if (err) {
res.json({ success: false });
} else {
res.json({ success: true });
}

});

});

/* -------------------------
LOGIN
------------------------- */

app.post("/login", (req, res) => {

const { username, password } = req.body;

db.get(
"SELECT * FROM users WHERE username=? AND password=?",
[username, password],
function (err, row) {

if (row) {

res.json({
success: true,
username: row.username,
profilePic: row.profilePic
});

} else {

res.json({ success: false });

}

});

});

/* -------------------------
FILE UPLOAD
------------------------- */

app.post("/upload", upload.single("file"), (req, res) => {

res.json({ file: req.file.filename });

});

/* -------------------------
REALTIME CHAT
------------------------- */

let users = {};

io.on("connection", (socket) => {

socket.on("join", (username) => {

users[username] = socket.id;

io.emit("user list", Object.keys(users));

});

socket.on("private message", (data) => {

let target = users[data.to];

db.run(
"INSERT INTO messages(sender,receiver,message) VALUES(?,?,?)",
[data.from, data.to, data.message]
);

if (target) {
io.to(target).emit("private message", data);
}

});

socket.on("disconnect", () => {

for (let user in users) {

if (users[user] === socket.id) {
delete users[user];
}

}

io.emit("user list", Object.keys(users));

});

});

/* -------------------------
START SERVER
------------------------- */

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
console.log("Server running on port " + PORT);
});
