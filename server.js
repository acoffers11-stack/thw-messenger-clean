const { Resend } = require("resend")
const resend = new Resend("re_HYPJqGeS_JDyF3wLJ1re1hWBFTdAW7kLd")

const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const sqlite3 = require("sqlite3").verbose()
const bodyParser = require("body-parser")
const multer = require("multer")
const path = require("path")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(bodyParser.json())
app.use(express.static("public"))
app.use("/uploads", express.static("uploads"))
app.use("/profiles", express.static("profiles"))

/* DATABASE */

const db = new sqlite3.Database("chat.db")

db.serialize(() => {

db.run(`CREATE TABLE IF NOT EXISTS users(
id INTEGER PRIMARY KEY AUTOINCREMENT,
username TEXT UNIQUE,
password TEXT,
email TEXT,
phone TEXT,
profilePic TEXT
)`)

db.run(`CREATE TABLE IF NOT EXISTS messages(
id INTEGER PRIMARY KEY AUTOINCREMENT,
sender TEXT,
receiver TEXT,
message TEXT,
type TEXT,
time TEXT,
status TEXT
)`)

db.run(`CREATE TABLE IF NOT EXISTS groups(
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT
)`)

db.run(`CREATE TABLE IF NOT EXISTS group_members(
groupId INTEGER,
username TEXT
)`)

})

/* EMAIL VERIFICATION (RESEND) */

let emailCodes = {}

async function sendVerificationEmail(email, code) {

try {

await resend.emails.send({
from: "Chat App <onboarding@resend.dev>",
to: email,
subject: "Your verification code",
html: `<h1>${code}</h1>`
})

console.log("Email sent to", email)

} catch (err) {

console.log("Email error:", err)

}

}

/* SEND CODE ROUTE */

app.post("/send-code", async (req,res)=>{

const {email} = req.body

const code = Math.floor(100000 + Math.random() * 900000)

emailCodes[email] = code

await sendVerificationEmail(email, code)

res.json({success:true})

})

/* FILE UPLOAD */

const storage = multer.diskStorage({
destination:(req,file,cb)=>cb(null,"uploads/"),
filename:(req,file,cb)=>cb(null,Date.now()+"-"+file.originalname)
})

const upload = multer({storage})

const profileStorage = multer.diskStorage({
destination:(req,file,cb)=>cb(null,"profiles/"),
filename:(req,file,cb)=>cb(null,Date.now()+"-"+file.originalname)
})

const profileUpload = multer({storage:profileStorage})

/* SIGNUP */

app.post("/signup",(req,res)=>{

const {username,password,email,phone,code}=req.body

if(emailCodes[email] != code){
return res.json({success:false})
}

db.run(
"INSERT INTO users(username,password,email,phone) VALUES(?,?,?,?)",
[username,password,email,phone],
(err)=>{

if(err){
return res.json({success:false})
}

delete emailCodes[email]

res.json({success:true})

})

})

/* LOGIN */

app.post("/login",(req,res)=>{

const {username,password}=req.body

db.get(
"SELECT * FROM users WHERE username=? AND password=?",
[username,password],
(err,row)=>{

if(row){
res.json({success:true,username})
}else{
res.json({success:false})
}

})

})

/* FILE UPLOAD */

app.post("/upload",upload.single("file"),(req,res)=>{

res.json({file:req.file.filename})

})

app.post("/upload-profile",profileUpload.single("photo"),(req,res)=>{

res.json({file:req.file.filename})

})

/* SOCKETS */

let users = {}

io.on("connection",(socket)=>{

socket.on("join",(username)=>{

users[username]=socket.id

io.emit("user list",Object.keys(users))

})

socket.on("private message",(data)=>{

const time = new Date().toISOString()

db.run(
"INSERT INTO messages(sender,receiver,message,type,time,status) VALUES(?,?,?,?,?,?)",
[
data.from,
data.to,
data.message,
data.type || "text",
time,
"sent"
]
)

let target = users[data.to]

if(target){

io.to(target).emit("private message",data)

io.to(socket.id).emit("delivered",{to:data.to})

}

})

socket.on("typing",(data)=>{

let target = users[data.to]

if(target){
io.to(target).emit("typing",data)
}

})

socket.on("read",(data)=>{

let target = users[data.to]

if(target){
io.to(target).emit("read",data)
}

})

/* GROUP CHAT */

socket.on("create group",(data)=>{

db.run(
"INSERT INTO groups(name) VALUES(?)",
[data.name],
function(){

const groupId = this.lastID

data.members.forEach(m=>{
db.run(
"INSERT INTO group_members(groupId,username) VALUES(?,?)",
[groupId,m]
)
})

}

)

})

socket.on("group message",(data)=>{

db.all(
"SELECT username FROM group_members WHERE groupId=?",
[data.groupId],
(err,rows)=>{

rows.forEach(r=>{

let id = users[r.username]

if(id){
io.to(id).emit("group message",data)
}

})

})

})

socket.on("disconnect",()=>{

for(let u in users){
if(users[u]==socket.id){
delete users[u]
}
}

io.emit("user list",Object.keys(users))

})

})

/* SERVER */

const PORT = process.env.PORT || 3000

server.listen(PORT, () => {

console.log("Server running on port " + PORT)

})