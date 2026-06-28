"""
AegisFlow Locust stress test — sustained 5,000 rps baseline workload.

Usage:
    pip install locust
    locust -f benchmarks/locust/locustfile.py --host=http://localhost:3000

Headless (5 min sustained):
    locust -f benchmarks/locust/locustfile.py --host=http://localhost:3000 \
           --headless -u 5000 -r 500 --run-time 5m \
           --csv=benchmarks/results/locust_report
"""

import json
import random
import string
import uuid

from locust import HttpUser, between, task


def random_name() -> str:
    first = "".join(random.choices(string.ascii_uppercase, k=1)) + "".join(
        random.choices(string.ascii_lowercase, k=random.randint(4, 8))
    )
    last = "".join(random.choices(string.ascii_uppercase, k=1)) + "".join(
        random.choices(string.ascii_lowercase, k=random.randint(4, 10))
    )
    return f"{first} {last}"


def random_email() -> str:
    user = "".join(random.choices(string.ascii_lowercase, k=8))
    domain = random.choice(["example.com", "corp.io", "test.org"])
    return f"{user}@{domain}"


def random_phone() -> str:
    return f"555-{random.randint(100, 999)}-{random.randint(1000, 9999)}"


def random_ssn() -> str:
    return f"{random.randint(100, 999)}-{random.randint(10, 99)}-{random.randint(1000, 9999)}"


class AegisFlowUser(HttpUser):
    wait_time = between(0.01, 0.05)

    def on_start(self):
        self.api_key = "dev-api-key-1"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    @task(10)
    def chat_completion_with_pii(self):
        prompt = (
            f"Analyze this customer: Name: {random_name()}, "
            f"Email: {random_email()}, Phone: {random_phone()}, "
            f"SSN: {random_ssn()}. Provide a brief summary."
        )
        payload = {
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 256,
        }
        headers = {**self.headers, "Idempotency-Key": str(uuid.uuid4())}
        with self.client.post(
            "/v1/chat/completions",
            data=json.dumps(payload),
            headers=headers,
            catch_response=True,
        ) as response:
            if response.status_code in (200, 429, 503):
                response.success()
            else:
                response.failure(f"Unexpected status: {response.status_code}")

    @task(2)
    def health_check(self):
        self.client.get("/health", headers=self.headers)

    @task(1)
    def idempotency_replay(self):
        key = f"locust-replay-{random.randint(1, 50)}"
        payload = {
            "model": "gpt-4o-mini",
            "messages": [
                {
                    "role": "user",
                    "content": f"Contact {random_name()} at {random_email()}",
                }
            ],
            "max_tokens": 128,
        }
        headers = {**self.headers, "Idempotency-Key": key}
        self.client.post(
            "/v1/chat/completions",
            data=json.dumps(payload),
            headers=headers,
        )
