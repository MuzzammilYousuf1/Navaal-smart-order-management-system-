"""
Internal Team Workspace Chat Router
Allows team members (Rider, Warehouse, Manager, Admin) to communicate,
assign work, comment on tasks, and discuss order fulfillment.
"""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
from auth import get_current_user
from sla_engine import broadcast_ws_message

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.get("/messages", response_model=List[schemas.ChatMessageOut])
def get_chat_messages(
    task_id: Optional[int] = None,
    order_id: Optional[int] = None,
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Retrieve workspace chat history."""
    query = db.query(models.ChatMessage)
    if task_id:
        query = query.filter(models.ChatMessage.task_id == task_id)
    if order_id:
        query = query.filter(models.ChatMessage.order_id == order_id)

    messages = query.order_by(models.ChatMessage.created_at.asc()).limit(limit).all()
    return messages


@router.post("/messages", response_model=schemas.ChatMessageOut)
def send_chat_message(
    data: schemas.ChatMessageCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Send a workspace chat message and broadcast in real-time via WebSocket."""
    if not data.message or not data.message.strip():
        raise HTTPException(status_code=400, detail="Message content cannot be empty")

    chat_msg = models.ChatMessage(
        sender_id=current_user.id,
        sender_name=current_user.name,
        sender_role=current_user.role,
        task_id=data.task_id,
        order_id=data.order_id,
        message=data.message.strip(),
        created_at=datetime.utcnow(),
        is_system_msg=False,
    )
    db.add(chat_msg)
    db.commit()
    db.refresh(chat_msg)

    # Broadcast over WebSocket
    broadcast_ws_message({
        "type": "chat_message",
        "id": chat_msg.id,
        "sender_name": chat_msg.sender_name,
        "sender_role": chat_msg.sender_role,
        "message": chat_msg.message,
        "task_id": chat_msg.task_id,
        "order_id": chat_msg.order_id,
        "timestamp": chat_msg.created_at.isoformat(),
    })

    return chat_msg
