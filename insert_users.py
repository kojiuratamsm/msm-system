import urllib.request
import json
import ssl

url = "https://xztaacxjlluzqzehendp.supabase.co/rest/v1/users"
headers = {
    "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ",
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}
data = [
    { "email": "urata@msm-jap.com", "password": "Koji2819", "role": "admin", "name": "管理者" },
    { "email": "contact@msm-fund.com", "password": "msm1234", "role": "member", "name": "社内メンバー (Plus One)" },
    { "email": "info@msm-fund.com", "password": "meo1234", "role": "member", "name": "社内メンバー (MEO)" },
    { "email": "jinzai@msm-fund.com", "password": "jinzai1234", "role": "member", "name": "社内メンバー (通信)" }
]

req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers, method='POST')
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    with urllib.request.urlopen(req, context=ctx) as response:
        print("Status:", response.status)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code, e.read().decode())
except Exception as e:
    print("Error:", e)
