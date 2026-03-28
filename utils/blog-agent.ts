import Groq from "groq-sdk";
import "dotenv/config";
import prisma from "../utils/db";

const client = new Groq();
const MODEL = "openai/gpt-oss-120b";

interface Blog {
    content: string;
    readTime: string;
}

export default async function blogAgent(userPrompt: string): Promise<Blog> {
    try {
        const chatCompletion = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `You are a helpful assistant who is an expert in writing blogs. 
                    You will be given a prompt and you have to write a blog based on that prompt. 
                    The blog should be engaging, informative, well-structured, and include relevant keywords.
                    
                    You MUST return the response in the following JSON format:
                    {
                        "content": "The blog content in markdown format",
                        "readTime": "Estimated reading time (e.g. '5 min')"
                    }`
                },
                {
                    role: "user",
                    content: userPrompt
                }
            ],
            response_format: { type: "json_object" }
        });

        const responseContent = chatCompletion.choices[0].message.content;
        if (!responseContent) {
            throw new Error("Empty response from AI");
        }

        const blogData: Blog = JSON.parse(responseContent);
        return blogData;
    } catch (error) {
        console.error("Error in blog agent:", error);
        return {
            content: "An error occurred while generating the blog content.",
            readTime: "0 min read"
        };
    }
}
