CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`pair` text NOT NULL,
	`side` text NOT NULL,
	`size` integer NOT NULL,
	`entryPrice` integer NOT NULL,
	`stopLoss` integer NOT NULL,
	`timestamp` integer NOT NULL,
	CONSTRAINT "positions_side_check" CHECK("positions"."side" IN ('Long', 'Short'))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`startTime` integer NOT NULL,
	`endTime` integer,
	`mode` text NOT NULL,
	`trades` integer DEFAULT 0 NOT NULL,
	`volume` integer DEFAULT 0 NOT NULL,
	`pnl` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`pair` text NOT NULL,
	`side` text NOT NULL,
	`size` integer NOT NULL,
	`price` integer NOT NULL,
	`pnl` integer NOT NULL,
	`fees` integer NOT NULL,
	`timestamp` integer NOT NULL,
	CONSTRAINT "trades_side_check" CHECK("trades"."side" IN ('Long', 'Short'))
);
