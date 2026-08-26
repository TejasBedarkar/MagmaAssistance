import asyncio
import httpx
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")

async def test_endpoint():
    url = "https://api.openai.com/v1/realtime/sessions"
    print(f"\nTesting {url}...")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-realtime-preview-2024-12-17",
                "modalities": ["audio", "text"],
                "voice": "alloy",
            }
        )
        print(f"Status (sessions endpoint): {resp.status_code}")
        
    url2 = "https://api.openai.com/v1/realtime/client_secrets"
    print(f"\nTesting {url2}...")
    async with httpx.AsyncClient() as client:
        resp2 = await client.post(
            url2,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
              "session": {
                "model": "gpt-4o-realtime-preview-2024-12-17",
                "modalities": ["audio", "text"],
                "instructions": "You are a helpful assistant.",
                "voice": "alloy"
              }
            }
        )
        print(f"Status (client_secrets wrapped): {resp2.status_code}")
        print(f"Body: {resp2.text}")
        
async def main():
    await test_endpoint()

asyncio.run(main())
