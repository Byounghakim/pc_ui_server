import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

// 특정 자동화 공정 조회
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 공정 ID' },
        { status: 400 }
      );
    }
    
    // 공정 조회
    const process = await kv.hget('processes', id);
    if (!process) {
      return NextResponse.json(
        { success: false, error: '존재하지 않는 공정' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ 
      success: true, 
      process 
    });
  } catch (error) {
    console.error('자동화 공정 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: '자동화 공정 조회 실패' },
      { status: 500 }
    );
  }
}

// 자동화 공정 업데이트
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const data = await request.json();
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 공정 ID' },
        { status: 400 }
      );
    }
    
    // 업데이트할 공정이 존재하는지 확인
    const existingProcess = await kv.hget('processes', id);
    if (!existingProcess) {
      return NextResponse.json(
        { success: false, error: '존재하지 않는 공정' },
        { status: 404 }
      );
    }
    
    // 필수 필드 검증
    if (!data.name || !data.sequences || !Array.isArray(data.sequences) || data.sequences.length === 0) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 공정 데이터' },
        { status: 400 }
      );
    }
    
    // 자동화 공정 객체 업데이트
    const updatedProcess = {
      ...existingProcess,
      name: data.name,
      description: data.description || existingProcess.description,
      sequences: data.sequences,
      updatedAt: new Date().toISOString()
    };
    
    // Vercel KV에 저장
    await kv.hset('processes', { [id]: updatedProcess });
    
    return NextResponse.json({ 
      success: true, 
      process: updatedProcess 
    });
  } catch (error) {
    console.error('자동화 공정 업데이트 오류:', error);
    return NextResponse.json(
      { success: false, error: '자동화 공정 업데이트 실패' },
      { status: 500 }
    );
  }
}

// 자동화 공정 삭제
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 공정 ID' },
        { status: 400 }
      );
    }
    
    // 공정이 실제로 존재하는지 확인
    const process = await kv.hget('processes', id);
    if (!process) {
      return NextResponse.json(
        { success: false, error: '존재하지 않는 공정' },
        { status: 404 }
      );
    }
    
    // Vercel KV에서 삭제
    await kv.hdel('processes', id);
    
    return NextResponse.json({ 
      success: true,
      message: '자동화 공정이 삭제되었습니다.'
    });
  } catch (error) {
    console.error('자동화 공정 삭제 오류:', error);
    return NextResponse.json(
      { success: false, error: '자동화 공정 삭제 실패' },
      { status: 500 }
    );
  }
} 