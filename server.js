const express = require("express")
const http = require("http")
const {Server} = require("socket.io")
const sqlite3 = require("sqlite3").verbose()
const bodyParser = require("body-parser")
const multer = require("multer")
const nodemailer = require("nodemailer")
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

db.serialize(()=>{

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

/* EMAIL */

const transporter = nodemailer.createTransport({
service:"gmail",
auth:{
user:"acoffers11@gmail.com",
pass:"qybsmaacspwcyyrv"
}
})

let emailCodes = {}

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

/* ROUTES */

app.post("/send-code",(req,res)=>{

const email = req.body.email
const code = Math.floor(100000+Math.random()*900000)

emailCodes[email]=code

transporter.sendMail({
from:"THW Messenger",
to:email,
subject:"Verification Code",
text:"Your verification code: "+code
})

res.json({success:true})

})

app.post("/signup",(req,res)=>{

const {username,password,email,phone,code}=req.body

if(emailCodes[email]!=code){
return res.json({success:false})
}

db.run(
"INSERT INTO users(username,password,email,phone) VALUES(?,?,?,?)",
[username,password,email,phone],
(err)=>{

if(err){
return res.json({success:false})
}

res.json({success:true})

})

})

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

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
console.log("Server running on port " + PORT);
});