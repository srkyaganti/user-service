import { EVENTS } from "@user-service/shared";
import { Queue, QueueEvents, Worker } from "bullmq";
import { logger } from "../lib/logger";
import { CacheService } from "./cache.service";

export class EventService {
	private static instance: EventService;
	private queues: Map<string, Queue> = new Map();
	private workers: Map<string, Worker> = new Map();
	private cache = CacheService.getInstance();

	private constructor() {}

	static getInstance(): EventService {
		if (!EventService.instance) {
			EventService.instance = new EventService();
		}
		return EventService.instance;
	}

	async publish(
		eventName: string,
		data: any,
		options?: {
			delay?: number;
			attempts?: number;
		},
	) {
		const queue = this.getQueue("events");

		await queue.add(
			eventName,
			{
				event: eventName,
				data,
				timestamp: new Date().toISOString(),
			},
			{
				delay: options?.delay,
				attempts: options?.attempts || 3,
				backoff: {
					type: "exponential",
					delay: 2000,
				},
			},
		);

		logger.debug({ eventName, data }, "Event published");
	}

	subscribe(eventName: string, handler: (data: any) => Promise<void>) {
		const worker = this.getWorker("events", async (job) => {
			if (job.name === eventName) {
				try {
					await handler(job.data.data);
					logger.debug({ eventName, jobId: job.id }, "Event processed");
				} catch (error) {
					logger.error(
						{ error, eventName, jobId: job.id },
						"Event processing failed",
					);
					throw error;
				}
			}
		});

		worker.on("failed", (job, err) => {
			logger.error(
				{
					error: err,
					eventName: job?.name,
					jobId: job?.id,
				},
				"Event job failed",
			);
		});
	}

	private getQueue(name: string): Queue {
		if (!this.queues.has(name)) {
			const queue = new Queue(name, {
				connection: this.cache.getClient(),
				defaultJobOptions: {
					removeOnComplete: {
						age: 3600, // 1 hour
						count: 1000,
					},
					removeOnFail: {
						age: 24 * 3600, // 1 day
					},
				},
			});

			this.queues.set(name, queue);
		}

		return this.queues.get(name)!;
	}

	private getWorker(
		name: string,
		processor: (job: any) => Promise<void>,
	): Worker {
		if (!this.workers.has(name)) {
			const worker = new Worker(name, processor, {
				connection: this.cache.getClient(),
				concurrency: 10,
			});

			this.workers.set(name, worker);
		}

		return this.workers.get(name)!;
	}

	async close() {
		// Close all workers
		await Promise.all(
			Array.from(this.workers.values()).map((worker) => worker.close()),
		);

		// Close all queues
		await Promise.all(
			Array.from(this.queues.values()).map((queue) => queue.close()),
		);

		this.workers.clear();
		this.queues.clear();
	}
}

// Set up event handlers
const events = EventService.getInstance();

// Example event handlers
events.subscribe(EVENTS.USER_CREATED, async (data) => {
	// Send welcome email
	logger.info({ userId: data.userId }, "Sending welcome email");
});

events.subscribe(EVENTS.USER_LOGGED_IN, async (data) => {
	// Update last login timestamp
	logger.info({ userId: data.userId }, "User logged in");
});

events.subscribe(EVENTS.MEMBER_INVITED, async (data) => {
	// Send invitation email
	logger.info({ email: data.email }, "Sending invitation email");
});

export { events as eventService };
