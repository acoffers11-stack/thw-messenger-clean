require("dotenv").config()
const bcrypt = require("bcryptjs")
const { Resend } = require("resend")
const resend = new Resend(process.env.RESEND_API_KEY || "re_HYPJqGeS_JDyF3wLJ1re1hWBFTdAW7kLd")

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
from: "Chat App <team@thehimalayanwolf.com>",
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

app.post("/signup",async (req,res)=>{

const {username,password,email,phone,code}=req.body

if(emailCodes[email] != code){
	return res.json({success:false, message: 'Invalid verification code'})
}

const hashed = await bcrypt.hash(password, 10)

db.run(
	"INSERT INTO users(username,password,email,phone) VALUES(?,?,?,?)",
	[username,hashed,email,phone],
	(err)=>{

		if(err){
			return res.json({success:false, message: 'Unable to create account'})
		}

		delete emailCodes[email]

		res.json({success:true})

	}

)

})

/* LOGIN */

app.post("/login",(req,res)=>{

const {username,password}=req.body

db.get(
"SELECT * FROM users WHERE username=?",
[username],
async (err,row)=>{

if(row){
	const match = await bcrypt.compare(password, row.password)
	if(match){
		res.json({success:true,username,profilePic:row.profilePic})
		return
	}
}

res.json({success:false})

}

)

})

/* PROFILE */

app.get('/profile/:username',(req,res)=>{
	const {username}=req.params
	db.get("SELECT username,email,phone,profilePic FROM users WHERE username=?",[username],(err,row)=>{
		if(err||!row) return res.status(404).json({error:'Not found'})
		res.json(row)
	})
})

/* CONVERSATIONS */

app.get('/conversations/:username',(req,res)=>{
	const {username} = req.params
	// fetch unique contacts and last message
	db.all(
		`SELECT sender, receiver, message, type, time, status
		 FROM messages
		 WHERE sender=? OR receiver=?
		 ORDER BY time DESC`,
		[username, username],
		(err, rows)=>{
			if(err) return res.status(500).json({error:'DB error'})
			const conv = {}
			rows.forEach(r=>{
				const other = r.sender===username ? r.receiver : r.sender
				if(!conv[other]) conv[other] = r
			})
			res.json(Object.keys(conv).map(k=>({
				contact:k,
				lastMessage:conv[k].message,
				time:conv[k].time,
				status:conv[k].status,
				type:conv[k].type
			})) )
		}
	)
})

/* MESSAGE HISTORY */

app.get('/messages',(req,res)=>{
	const {user,contact} = req.query
	if(!user||!contact) return res.status(400).json({error:'missing'})
	db.all(
		"SELECT sender,receiver,message,type,time,status FROM messages WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?) ORDER BY time ASC",
		[user,contact,contact,user],
		(err,rows)=>{
			if(err) return res.status(500).json({error:'DB error'})
			res.json(rows)
		}
	)
})

/* MARK READ */

app.post('/read',(req,res)=>{
	const {user,contact} = req.body
	if(!user||!contact) return res.status(400).json({error:'missing'})
	db.run(
		"UPDATE messages SET status='read' WHERE sender=? AND receiver=?",
		[contact,user],
		(err)=>{
			if(err) return res.status(500).json({error:'DB error'})
			res.json({success:true})
		}
	)
})

/* CALL LOGS */

app.post('/call',(req,res)=>{
	const {from,to,type} = req.body
	const time = new Date().toISOString()
	// store in db table calls if exists
	db.run("CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY AUTOINCREMENT, caller TEXT, callee TEXT, type TEXT, time TEXT)")
	db.run("INSERT INTO calls(caller,callee,type,time) VALUES(?,?,?,?)",[from,to,type,time])
	res.json({success:true})
})

app.get('/calls/:username',(req,res)=>{
	const {username} = req.params
	db.all("SELECT * FROM calls WHERE caller=? OR callee=? ORDER BY time DESC",[username,username],(err,rows)=>{
		if(err) return res.status(500).json({error:'DB error'})
		res.json(rows)
	})
})

/* FILE UPLOAD */

app.post("/upload",upload.single("file"),(req,res)=>{

res.json({file:req.file.filename})

})

app.post("/upload-profile",profileUpload.single("photo"),(req,res)=>{

const username = req.body.username

if(username){
	db.run("UPDATE users SET profilePic=? WHERE username=?",[req.file.filename, username])
}

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

// update database status to read
if(data.from && data.to){
	db.run("UPDATE messages SET status='read' WHERE sender=? AND receiver=?",[data.to,data.from])
}

if(target){
io.to(target).emit("read",data)
}

})

socket.on("call",(data)=>{
	let target = users[data.to]
	if(target){
		io.to(target).emit("call", data)
	}
})

socket.on("call-accepted",(data)=>{
	let target = users[data.to]
	if(target){
		io.to(target).emit("call-accepted", data)
	}
})

socket.on("call-declined",(data)=>{
	let target = users[data.to]
	if(target){
		io.to(target).emit("call-declined", data)
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