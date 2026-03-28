import express from "express"
import jwt from "jsonwebtoken"
import "dotenv/config"
import startChat from "./agent"
import authMiddleware from "../utils/middleware"
import cors from "cors"
import prisma from "../utils/db"
import upload from "../utils/multer"
import blogAgent from "../utils/blog-agent"

const app = express()

app.use(cors(
    {
        origin: ["ai-todo-puce.vercel.app", "http://localhost:3000"],
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    }
))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use("/uploads", express.static("uploads"))


app.post("/register", async (req, res) => {
    const { name, email, username, password } = req.body
    try {
        const user = await prisma.user.create({ data: { name: name, email: email, username: username, password: password } })
        res.status(200).json({ message: "User registered successfully", user })
    } catch (error) {
        res.status(500).json({ message: "An error occurred while processing your request" })
    }
})

app.post("/login", async (req, res) => {
    const { uniqueIdentifier, password } = req.body
    try {
        const user = await prisma.user.findFirst(
            {
                where: {
                    OR: [
                        { username: uniqueIdentifier },
                        { email: uniqueIdentifier }
                    ]
                }
            })
        if (user && user.password === password) {
            const token = jwt.sign({ username: user.username, id: user.id }, process.env.JWT_SECRET!, { expiresIn: "7d" })
            res.status(200).json({ message: "Login successful", token })
        } else {
            res.status(401).json({ message: "Invalid credentials" })
        }
    } catch (error) {
        res.status(500).json({ message: "An error occurred while processing your request" })
    }
})
app.get("/getPostByUser", authMiddleware, async (req, res) => {
    try {
        const currentUser = req.user;
        const posts = await prisma.post.findMany({ where: { userId: currentUser?.id } })
        res.status(200).json({ message: "Posts fetched successfully", posts })
    } catch (error) {
        res.status(500).json({ message: "An error occurred while processing your request" })
    }
})

app.post("/createBlog", authMiddleware, upload.array("gallery"), async (req, res) => {
    try {
        const currentUser = req.user;
        if (!currentUser) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        // Ensure profile exists
        let profile = await prisma.profile.findUnique({ where: { userId: currentUser.id } });
        if (!profile) {
            profile = await prisma.profile.create({ data: { userId: currentUser.id } });
        }

        const files = req.files as Express.Multer.File[];
        const gallery = files ? files.map((file) => file.path.replace(/\\/g, "/")) : [];

        let categoryId = parseInt(req.body.categoryId);
        if (req.body.newCategory) {
            const category = await prisma.category.create({ data: { name: req.body.newCategory } });
            categoryId = category.id;
        }

        if (isNaN(categoryId)) {
            res.status(400).json({ message: "Category is required" });
            return;
        }

        const blog = await prisma.blogs.create({
            data: {
                title: req.body.title,
                content: req.body.content,
                readtime: req.body.readtime,
                gallery: gallery,
                author: { connect: { id: currentUser.id } },
                profile: { connect: { id: profile.id } },
                category: { connect: { id: categoryId } }
            }
        })
        res.status(200).json({ message: "Blog created successfully", blog })
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: "An error occurred while processing your request" })
    }
})

app.get("/getBlogByUser", authMiddleware, async (req, res) => {
    try {
        const currentUser = req.user;
        const blogs = await prisma.blogs.findMany({
            where: { userId: currentUser?.id },
            include: { category: true }
        })
        res.status(200).json({ message: "Blogs fetched successfully", blogs })
    } catch (error) {
        res.status(500).json({ message: "An error occurred while processing your request" })
    }
})

app.delete("/deleteBlog/:id", authMiddleware, async (req, res) => {
    try {
        const currentUser = req.user;
        const id = parseInt(req.params.id as string);

        if (isNaN(id)) {
            res.status(400).json({ message: "Invalid blog ID" });
            return;
        }

        const blog = await prisma.blogs.findUnique({ where: { id } });

        if (!blog) {
            res.status(404).json({ message: "Blog not found" });
            return;
        }

        if (blog.userId !== currentUser?.id) {
            res.status(403).json({ message: "You are not authorized to delete this blog" });
            return;
        }

        // Delete saved blogs first due to relations if any (Prisma handles cascade if specified, but safety first)
        await prisma.blogs.delete({ where: { id } });
        res.status(200).json({ message: "Blog deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "An error occurred while processing your request" });
    }
})

app.put("/updateBlog/:id", authMiddleware, upload.array("gallery"), async (req, res) => {
    try {
        const currentUser = req.user;
        const id = parseInt(req.params.id as string);

        if (isNaN(id)) {
            res.status(400).json({ message: "Invalid blog ID" });
            return;
        }

        const blog = await prisma.blogs.findUnique({ where: { id } });

        if (!blog) {
            res.status(404).json({ message: "Blog not found" });
            return;
        }

        if (blog.userId !== currentUser?.id) {
            res.status(403).json({ message: "You are not authorized to update this blog" });
            return;
        }

        const files = req.files as Express.Multer.File[];
        const gallery = files && files.length > 0 ? files.map((file) => file.path.replace(/\\/g, "/")) : blog.gallery;

        let categoryId = blog.categoryId;
        if (req.body.categoryId) {
            categoryId = parseInt(req.body.categoryId);
        }
        if (req.body.newCategory) {
            const category = await prisma.category.create({ data: { name: req.body.newCategory } });
            categoryId = category.id;
        }

        const updatedBlog = await prisma.blogs.update({
            where: { id },
            data: {
                title: req.body.title || blog.title,
                content: req.body.content || blog.content,
                readtime: req.body.readtime || blog.readtime,
                gallery: gallery,
                categoryId: categoryId
            }
        })
        res.status(200).json({ message: "Blog updated successfully", blog: updatedBlog })
    } catch (error) {
        res.status(500).json({ message: "An error occurred while processing your request" })
    }
})



app.post("/saveBlog/:blogId", authMiddleware, async (req, res) => {
    try {
        const currentUser = req.user;
        if (!currentUser) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        // Ensure profile exists
        let profile = await prisma.profile.findUnique({ where: { userId: currentUser.id } });
        if (!profile) {
            profile = await prisma.profile.create({ data: { userId: currentUser.id } });
        }

        const blogId = parseInt(req.params.blogId as string);

        if (isNaN(blogId)) {
            res.status(400).json({ message: "Invalid blog ID" });
            return;
        }

        const existingSave = await prisma.savedBlogs.findFirst({
            where: {
                userId: currentUser.id,
                blogId: blogId,
            }
        });

        if (existingSave) {
            await prisma.savedBlogs.delete({
                where: {
                    id: existingSave.id
                }
            });
            res.status(200).json({ message: "Blog unsaved successfully", isSaved: false });
        } else {
            await prisma.savedBlogs.create({
                data: {
                    userId: currentUser.id,
                    blogId: blogId,
                    profileId: profile.id
                }
            });
            res.status(200).json({ message: "Blog saved successfully", isSaved: true });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "An error occurred while processing your request" })
    }
})

// Profile Routes
app.get("/getProfile", authMiddleware, async (req, res) => {
    try {
        const currentUser = req.user;
        const profile = await prisma.profile.findUnique({
            where: { userId: currentUser?.id },
            include: { socials: true }
        });
        res.status(200).json({ profile });
    } catch (error) {
        res.status(500).json({ message: "Error fetching profile" });
    }
});

app.post("/updateProfile", authMiddleware, upload.fields([
    { name: 'profilePic', maxCount: 1 },
    { name: 'bannerPic', maxCount: 1 }
]), async (req, res) => {
    try {
        const currentUser = req.user;
        if (!currentUser) return res.status(401).json({ message: "Unauthorized" });

        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        const profilePic = files?.profilePic?.[0]?.path.replace(/\\/g, "/");
        const bannerPic = files?.bannerPic?.[0]?.path.replace(/\\/g, "/");

        const { bio, contact, address, dob, gender, socials } = req.body;

        const data: any = {
            bio,
            contact,
            address,
            gender,
            dob: dob ? new Date(dob) : undefined
        };

        if (profilePic) data.profilePic = profilePic;
        if (bannerPic) data.bannerPic = bannerPic;

        const profile = await prisma.profile.upsert({
            where: { userId: currentUser.id },
            update: data,
            create: { ...data, userId: currentUser.id }
        });

        // Handle socials if provided
        if (socials && Array.isArray(JSON.parse(socials))) {
            const socialsList = JSON.parse(socials);
            // Simple approach: delete existing and recreat (or upsert if you have IDs)
            await prisma.socials.deleteMany({ where: { profileId: profile.id } });
            await prisma.socials.createMany({
                data: socialsList.map((s: any) => ({
                    profileId: profile.id,
                    name: s.name,
                    link: s.link
                }))
            });
        }

        res.status(200).json({ message: "Profile updated successfully", profile });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error updating profile" });
    }
});

// Category Routes
app.get("/getCategories", async (req, res) => {
    try {
        const categories = await prisma.category.findMany();
        res.status(200).json({ categories });
    } catch (error) {
        res.status(500).json({ message: "Error fetching categories" });
    }
});


app.get("/getAllBlogs", async (req, res) => {
    try {
        const blogs = await prisma.blogs.findMany({
            include: {
                author: {
                    select: {
                        name: true,
                        username: true
                    }
                },
                category: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.status(200).json({ message: "All blogs fetched successfully", blogs })
    } catch (error) {
        res.status(500).json({ message: "An error occurred while processing your request" })
    }
})

app.get("/getSavedBlogByUser", authMiddleware, async (req, res) => {
    try {
        const currentUser = req.user;
        const savedBlogs = await prisma.savedBlogs.findMany({
            where: { userId: currentUser?.id },
            include: {
                blog: {
                    include: {
                        author: {
                            select: {
                                name: true
                            }
                        },
                        category: true
                    }
                }
            }
        })
        res.status(200).json({ message: "Saved blogs fetched successfully", savedBlogs })
    } catch (error) {
        res.status(500).json({ message: "An error occurred while processing your request" })
    }
})


app.post("/ai-chat", authMiddleware, async (req, res) => {
    try {
        const currentUser = req.user;
        const result = await startChat(req.body.userPrompt, currentUser);

        res.status(200).json({
            success: true,
            message: result.message,
            data: result.functions.length > 0 ? result.functions[0].result : null,
            executedFunctions: result.functions,
            currentUser
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "An error occurred while processing your request",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
})

app.get("/getBlogById/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const blog = await prisma.blogs.findUnique({
            where: { id },
            include: {
                author: {
                    select: {
                        name: true,
                        username: true
                    }
                }
            }
        });

        if (!blog) {
            res.status(404).json({ message: "Blog not found" });
            return;
        }

        // Check if blog is saved if user is logged in
        let isSaved = false;
        const authHeader = req.headers.authorization;
        if (authHeader) {
            try {
                const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;
                const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: number };
                const saved = await prisma.savedBlogs.findFirst({
                    where: {
                        userId: decoded.id,
                        blogId: id
                    }
                });
                isSaved = !!saved;
            } catch (e) {
                // Ignore invalid token, just return isSaved = false
            }
        }

        res.status(200).json({ message: "Blog fetched successfully", blog, isSaved });
    } catch (error) {
        res.status(500).json({ message: "An error occurred while processing your request" });
    }
});

app.post("/ai-blog", authMiddleware, async (req, res) => {
    try {
        const result = await blogAgent(req.body.userPrompt);

        res.status(200).json({
            success: true,
            data: result,

        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "An error occurred while processing your request",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
})


app.listen(4000, () => {
    console.log("Server started on  http://localhost:4000")
})