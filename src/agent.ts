import Groq from "groq-sdk";
import "dotenv/config";
import prisma from "../utils/db";
import readlineSync from "readline-sync";

async function Createpost(title: string, content: string, username: string) {
    // Find the user's profile first
    const user = await prisma.user.findUnique({
        where: { username },
        include: { profile: true }
    });

    if (!user || !user.profile) {
        // Fallback: create profile if missing
        const newUserWithProfile = await prisma.user.update({
            where: { username },
            data: {
                profile: {
                    create: {}
                }
            },
            include: { profile: true }
        });

        const post = await prisma.post.create({
            data: {
                title,
                content,
                userId: newUserWithProfile.id,
                profileId: newUserWithProfile.profile!.id
            }
        });
        return post;
    }

    const post = await prisma.post.create({
        data: {
            title,
            content,
            userId: user.id,
            profileId: user.profile.id
        },
    });
    console.log("CREATED POST-->", post);
    return post;
}

async function getAllPost(username: string) {
    const posts = await prisma.post.findMany({
        where: {
            user: {
                username: username
            }
        }
    });
    console.log("ALL POSTS-->", posts);
    return posts;
}

async function getPostByTitleOrContent(title: string, content: string, username: string) {
    const post = await prisma.post.findMany({
        where: {
            user: {
                username: username
            },
            OR: [
                { title: { contains: title, mode: "insensitive" } },
                { content: { contains: content, mode: "insensitive" } }
            ]
        }
    });
    console.log("FOUND POSTS-->", post);
    return post;
}

async function DeletePost(title: string, content: string, username: string) {
    const post = await prisma.post.findMany({
        where: {
            user: {
                username: username
            },
            OR: [
                { title: { contains: title, mode: "insensitive" } },
                { content: { contains: content, mode: "insensitive" } }
            ]
        }
    });

    if (post.length === 0) {
        console.log("No posts found matching the criteria");
        return { deleted: 0, posts: [] };
    }

    const deletedPosts: any[] = [];
    for (let i = 0; i < post.length; i++) {
        await prisma.post.deleteMany({
            where: {
                id: post[i].id
            }
        });
        deletedPosts.push(post[i]);
        console.log("DELETED POST-->", post[i]);
    }

    return { deleted: deletedPosts.length, posts: deletedPosts };
}


// Initialize the Groq client
const client = new Groq();
const MODEL = "openai/gpt-oss-120b";


async function runConversation(userPrompt: string, username: string) {
    const messages: any[] = [
        {
            role: "system",
            content:
                "You are a database management system. Use the appropriate functions to perform any database operations and provide the results."
        },
        {
            role: "user",
            content: userPrompt,
        },
    ];

    // Define the tool schema
    const tools = [
        {
            type: "function",
            function: {
                name: "Createpost",
                description: "Create a new post",
                parameters: {
                    type: "object",
                    properties: {
                        title: {
                            type: "string",
                            description: "The title of the post",
                        },
                        content: {
                            type: "string",
                            description: "The content of the post",
                        },
                    },
                    required: ["title", "content"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "DeletePost",
                description: "Delete a post by matching title or content",
                parameters: {
                    type: "object",
                    properties: {
                        title: {
                            type: "string",
                            description: "The title of the post",
                        },
                        content: {
                            type: "string",
                            description: "The content of the post",
                        },
                    },
                    required: ["title", "content"],
                },
            },
        }, {
            type: "function",
            function: {
                name: "getAllPost",
                description: "Get all posts from the database",
                parameters: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            },
        }, {
            type: "function",
            function: {
                name: "getPostByTitleOrContent",
                description: "Searches for a post by title or content",
                parameters: {
                    type: "object",
                    properties: {
                        title: {
                            type: "string",
                            description: "The title of the post",
                        },
                        content: {
                            type: "string",
                            description: "The content of the post",
                        },
                    },
                    required: ["title", "content"],
                },
            },
        }, {
            type: "browser_search"
        }
    ];

    const response = await client.chat.completions.create({
        model: MODEL,
        messages: messages,
        tools: tools,
        tool_choice: "auto",
        stream: true
    });

    let collectedContent = "";
    let collectedToolCalls: any[] = [];
    let finishReason: any = null;

    for await (const chunk of response) {
        if (chunk.choices[0].delta.content) {
            collectedContent += chunk.choices[0].delta.content;
        }
        if (chunk.choices[0].delta.tool_calls) {
            collectedToolCalls.push(...chunk.choices[0].delta.tool_calls);
        }
        if (chunk.choices[0].finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
        }
    } console.log("RESPONSE MESSAGE->", collectedContent)
    const toolCalls = collectedToolCalls;
    console.log("TOOL CALLED->", toolCalls)

    if (toolCalls) {
        const availableFunctions: Record<string, Function> = {
            Createpost: Createpost,
            DeletePost: DeletePost,
            getAllPost: getAllPost,
            getPostByTitleOrContent: getPostByTitleOrContent,
        };

        messages.push({
            role: "assistant",
            content: collectedContent,
            tool_calls: collectedToolCalls
        });

        const executedFunctions: any[] = [];

        for (const toolCall of toolCalls) {
            if (!toolCall.function) {
                console.warn("Tool call missing function definition, skipping...");
                continue;
            }

            const functionName = toolCall.function.name;

            if (!functionName || !availableFunctions[functionName]) {
                console.warn(`Function ${functionName || 'undefined'} not found, skipping...`);
                continue;
            }

            if (!toolCall.function.arguments && functionName !== "getAllPost") {
                console.warn(`Function ${functionName} missing arguments, skipping...`);
                continue;
            }

            const functionToCall = availableFunctions[functionName];
            console.log("FUNCTION TO CALL-->", functionToCall);
            const functionArgs = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};

            let functionResult;
            if (functionName === "getAllPost") {
                functionResult = await functionToCall(username);
            } else {
                functionResult = await functionToCall(functionArgs.title, functionArgs.content, username);
            }

            executedFunctions.push({
                name: functionName,
                arguments: functionArgs,
                result: functionResult
            });

            const functionResponse = JSON.stringify({
                success: true,
                message: `${functionName} executed successfully`,
                data: functionResult
            });

            messages.push({
                tool_call_id: toolCall.id,
                role: "tool",
                name: functionName,
                content: functionResponse,
            });
        }

        const secondResponse = await client.chat.completions.create({
            model: MODEL,
            messages: messages,
            stream: true,
        });
        for await (const chunk of secondResponse) {
            if (chunk.choices[0].delta.content) {
                collectedContent += chunk.choices[0].delta.content;
            }
        }
        console.log("COLLECTED CONTENT-->", collectedContent)
        return {
            message: collectedContent,
            functions: executedFunctions
        };
    }

    return {
        message: collectedContent,
        functions: []
    };
}

async function startChat(UserPrompt: string, currentUser?: { username: string }) {
    const userPrompt = UserPrompt || readlineSync.question("\n\x1b[36mYou:\x1b[0m ");
    try {
        console.log("\x1b[35mAssistant:\x1b[0m Thinking...");
        const result = await runConversation(userPrompt, currentUser?.username || "Mayank");
        console.log(`\x1b[35mAssistant:\x1b[0m ${result.message || "Task completed successfully!"}`);
        return result;
    } catch (error) {
        console.error(`\x1b[31mError:\x1b[0m ${error instanceof Error ? error.message : "An error occurred"}`);
        throw error;
    }
}


export default startChat;
