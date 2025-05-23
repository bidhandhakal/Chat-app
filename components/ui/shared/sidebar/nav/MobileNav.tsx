"use client";

import { UserButton } from "@clerk/nextjs";
import { Card } from "@/components/ui/card";
import { useNavigation } from "@/hooks/useNavigation";
import Link from "next/link";
import { Tooltip } from "@radix-ui/react-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useConversation } from "@/hooks/useConversation";
import { ThemeToggle } from "@/components/ui/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const MobileNav = () => {
    const paths = useNavigation();

    const { isActive } = useConversation();
    if (isActive) return null;

    return (
        <Card className="fixed bottom-0 w-[calc(100%-32px)] lg:hidden flex items-center px-4 py-2 z-50 border-0">
            <nav className="w-full">
                <ul className="flex justify-between items-center px-4 gap-2">
                    {paths.map((path, id) => {
                        return (
                            <li key={id} className="relative">
                                <Link href={path.href}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className={cn(
                                                    "hover:bg-transparent",
                                                    path.active && "bg-transparent hover:bg-transparent"
                                                )}
                                            >
                                                <span className={cn(
                                                    "p-2 rounded-lg transition-all duration-200",
                                                    path.active
                                                        ? "bg-blue-500/20 ring-1 ring-blue-500/30"
                                                        : "hover:bg-muted/50"
                                                )}>
                                                    <span className={cn(
                                                        "dark:text-white text-black",
                                                        path.active && "text-blue-600 dark:text-blue-200"
                                                    )}>
                                                        {path.icon}
                                                    </span>
                                                </span>
                                                {path.count ? (
                                                    <Badge className="absolute left-6 bottom-6 px-2">
                                                        {path.count}
                                                    </Badge>
                                                ) : null}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>{path.name}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </Link>
                            </li>
                        );
                    })}
                    <li><ThemeToggle /></li>
                    <li>
                        <UserButton />
                    </li>
                </ul>
            </nav>
        </Card>
    );
};

export default MobileNav;